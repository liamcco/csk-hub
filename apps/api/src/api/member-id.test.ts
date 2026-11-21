import { afterAll, afterEach, describe, expect, type Mock, setSystemTime, test } from "bun:test"
import { getMemberIdSession, issueMemberId, verifyMemberId } from "@csk-hub/contract/client"
import { createClient } from "@csk-hub/contract/client/client"
import { logger } from "@csk-hub/shared/core/logging"
import { eq } from "drizzle-orm"
import { createAuth } from "@/core/auth/create-auth"
import { session, user } from "@/core/db/schema/auth"
import { group, groupMember } from "@/core/db/schema/org-structure"
import { createApiDependencies } from "@/core/http"
import { createTestDatabase } from "../../test/database"
import { createApi } from "./app"

const database = await createTestDatabase()
const origin = "http://localhost:3000"
const password = "member-id-test-password"
const secret = "member-id-disposable-test-secret"

describe.skipIf(!database)("Member ID over HTTP", () => {
  const t = database as NonNullable<typeof database>
  afterAll(() => t.drop())
  afterEach(() => setSystemTime())

  const auth = createAuth({ database: t.db, baseURL: origin, production: false, secret })
  const api = createApi(createApiDependencies({ auth, database: t.db, secret }))

  /** The iPhone companion's request shape: cookie, Hub Origin and, for verification, a JSON body. */
  function legacyRequest(
    path: string,
    init: { method?: string; cookie?: string; body?: BodyInit; type?: string } = {}
  ) {
    const headers: Record<string, string> = { origin }
    if (init.cookie) headers.cookie = init.cookie
    if (init.type) headers["content-type"] = init.type
    return api.request(`${origin}${path}`, { method: init.method ?? "GET", headers, body: init.body })
  }

  /** The generated TypeScript client, sending the session cookie like a native client. */
  function generatedClient(cookie?: string) {
    return createClient({
      baseUrl: origin,
      headers: { origin, ...(cookie ? { cookie } : {}) },
      fetch: ((input, init) => api.request(input, init)) as typeof fetch
    })
  }

  async function createMember({ role = "user", name = "Singer" }: { role?: "user" | "admin"; name?: string } = {}) {
    const email = `${crypto.randomUUID()}@example.test`
    const created = await auth.api.createUser({ body: { email, password, name, role } })
    return { id: created.user.id, email, name }
  }

  async function signIn(email: string) {
    const response = await api.request(`${origin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    })
    expect(response.status).toBe(200)
    return response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ")
  }

  async function signOut(cookie: string) {
    const response = await legacyRequest("/api/auth/sign-out", {
      method: "POST",
      cookie,
      body: "{}",
      type: "application/json"
    })
    expect(response.status).toBe(200)
  }

  async function joinChoir(userId: string, name: string) {
    const [choir] = await t.db.insert(group).values({ name, type: "Choir" }).returning({ id: group.id })
    await t.db.insert(groupMember).values({ userId, groupId: choir.id, startDate: "2026-01-01" })
    return { id: choir.id, name }
  }

  async function issueCode(cookie: string): Promise<string> {
    const response = await legacyRequest("/api/member-id/issue", { method: "POST", cookie })
    expect(response.status).toBe(200)
    return (await response.json()).token
  }

  function verify(cookie: string, body: BodyInit, type = "application/json") {
    return legacyRequest("/api/member-id/verify", { method: "POST", cookie, body, type })
  }

  function expectPrivate(response: Response) {
    expect(response.headers.get("cache-control")).toBe("no-store, private")
    expect(response.headers.get("pragma")).toBe("no-cache")
    expect(response.headers.get("content-type")).toStartWith("application/json")
  }

  test("returns the signed-in member's own profile and Choirs with scanner availability", async () => {
    const member = await createMember({ name: "Alto Anna" })
    const choir = await joinChoir(member.id, "Kammarkören")
    const cookie = await signIn(member.email)

    const response = await legacyRequest("/api/member-id/session", { cookie })

    expect(response.status).toBe(200)
    expectPrivate(response)
    expect(await response.json()).toEqual({
      member: { id: member.id, name: "Alto Anna", image: null, accountStatus: "active", choirs: [choir] },
      canVerify: false
    })
  })
  test("serves the same profile through the generated client", async () => {
    const member = await createMember({ role: "admin" })
    const cookie = await signIn(member.email)

    const { data, response } = await getMemberIdSession({ client: generatedClient(cookie) })

    expect(response?.status).toBe(200)
    expect(data).toEqual({
      member: { id: member.id, name: member.name, image: null, accountStatus: "active", choirs: [] },
      canVerify: true
    })
  })
  test("issues a rotating ten-second code for the caller's own session", async () => {
    const member = await createMember()
    const cookie = await signIn(member.email)
    const before = Date.now()

    const response = await legacyRequest("/api/member-id/issue", { method: "POST", cookie })

    expect(response.status).toBe(200)
    expectPrivate(response)
    const issued = await response.json()
    expect(issued).toEqual({
      token: expect.stringMatching(/^csk-id:1:/),
      issuedAt: expect.any(Number),
      expiresAt: issued.issuedAt + 10_000,
      rotateAfterMs: 5_000
    })
    expect(issued.issuedAt).toBeGreaterThanOrEqual(before)
    expect(issued.issuedAt).toBeLessThanOrEqual(Date.now())
    expect(issued.token).not.toContain(member.id)
  })
  test("lets an Admin verify a member's code and see their current Choirs", async () => {
    const member = await createMember({ name: "Bass Bo" })
    const choir = await joinChoir(member.id, "Manskören")
    const code = await issueCode(await signIn(member.email))
    const admin = await createMember({ role: "admin" })
    const adminCookie = await signIn(admin.email)
    const before = Date.now()

    const response = await verify(adminCookie, JSON.stringify({ token: code }))

    expect(response.status).toBe(200)
    expectPrivate(response)
    const verified = await response.json()
    expect(verified).toEqual({
      member: { id: member.id, name: "Bass Bo", image: null, accountStatus: "active", choirs: [choir] },
      verifiedAt: expect.any(Number)
    })
    expect(verified.verifiedAt).toBeGreaterThanOrEqual(before)
  })
  test("issues and verifies codes through the generated client", async () => {
    const member = await createMember()
    const memberClient = generatedClient(await signIn(member.email))
    const admin = await createMember({ role: "admin" })
    const adminClient = generatedClient(await signIn(admin.email))

    const issued = await issueMemberId({ client: memberClient })
    expect(issued.response?.status).toBe(200)
    expect(issued.data?.rotateAfterMs).toBe(5_000)

    const verified = await verifyMemberId({ client: adminClient, body: { token: issued.data?.token ?? "" } })
    expect(verified.response?.status).toBe(200)
    expect(verified.data?.member).toEqual({
      id: member.id,
      name: member.name,
      image: null,
      accountStatus: "active",
      choirs: []
    })

    const refused = await verifyMemberId({ client: memberClient, body: { token: issued.data?.token ?? "" } })
    expect(refused.response?.status).toBe(403)
    expect(refused.error).toEqual({ code: "FORBIDDEN" })
  })

  describe("refuses codes that are no longer or never were valid", () => {
    async function scene() {
      const member = await createMember()
      const memberCookie = await signIn(member.email)
      const admin = await createMember({ role: "admin" })
      return { member, memberCookie, code: await issueCode(memberCookie), adminCookie: await signIn(admin.email) }
    }

    async function expectInvalidCode(response: Response) {
      expect(response.status).toBe(400)
      expectPrivate(response)
      expect(await response.json()).toEqual({ code: "INVALID_CODE" })
    }

    test("accepts a code before ten seconds and refuses it at ten seconds", async () => {
      const { code, adminCookie } = await scene()
      const issuedAt = Date.now()

      setSystemTime(issuedAt + 8_000)
      expect((await verify(adminCookie, JSON.stringify({ token: code }))).status).toBe(200)
      setSystemTime(issuedAt + 10_000)
      await expectInvalidCode(await verify(adminCookie, JSON.stringify({ token: code })))
    })

    test("refuses forged, foreign and garbage codes alike", async () => {
      const { code, adminCookie } = await scene()
      const forged = `${code.slice(0, 20)}${code[20] === "A" ? "B" : "A"}${code.slice(21)}`

      for (const token of [forged, "csk-id:1:AAAA", "https://example.com", ""]) {
        await expectInvalidCode(await verify(adminCookie, JSON.stringify({ token })))
      }
    })

    test("refuses a code once its holder signs out, expires or is impersonated", async () => {
      const revoked = await scene()
      await signOut(revoked.memberCookie)
      await expectInvalidCode(await verify(revoked.adminCookie, JSON.stringify({ token: revoked.code })))

      const expired = await scene()
      await t.db
        .update(session)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(session.userId, expired.member.id))
      await expectInvalidCode(await verify(expired.adminCookie, JSON.stringify({ token: expired.code })))

      const impersonated = await scene()
      const admin = await createMember({ role: "admin" })
      await t.db.update(session).set({ impersonatedBy: admin.id }).where(eq(session.userId, impersonated.member.id))
      await expectInvalidCode(await verify(impersonated.adminCookie, JSON.stringify({ token: impersonated.code })))
    })

    test("refuses an Inactive User's code without disclosing why", async () => {
      const { member, code, adminCookie } = await scene()

      await t.db.update(user).set({ banned: true }).where(eq(user.id, member.id))

      await expectInvalidCode(await verify(adminCookie, JSON.stringify({ token: code })))
    })
  })

  describe("rejects malformed verification input before authentication", () => {
    async function expectInvalidRequest(response: Response, status: number) {
      expect(response.status).toBe(status)
      expectPrivate(response)
      expect(await response.json()).toEqual({ code: "INVALID_REQUEST" })
    }

    test("refuses non-JSON content types with 415", async () => {
      await expectInvalidRequest(await verify("", JSON.stringify({ token: "x" }), "text/plain"), 415)
      const untyped = await legacyRequest("/api/member-id/verify", {
        method: "POST",
        body: JSON.stringify({ token: "x" })
      })
      await expectInvalidRequest(untyped, 415)
    })

    test("refuses malformed JSON and token shapes with 400", async () => {
      const tooLong = JSON.stringify({ token: `csk-id:1:${"A".repeat(2040)}` })
      for (const body of ["", "{", "[]", "null", '"token"', "{}", '{"token":42}', tooLong]) {
        await expectInvalidRequest(await verify("", body), 400)
      }
    })

    test("refuses bodies over 4 KiB with 413, even when streamed", async () => {
      await expectInvalidRequest(await verify("", JSON.stringify({ token: "A".repeat(4100) })), 413)

      const chunk = new TextEncoder().encode(" ".repeat(1024))
      let sent = 0
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent++ < 64) controller.enqueue(chunk)
          else controller.close()
        }
      })
      await expectInvalidRequest(await verify("", stream), 413)
      expect(sent).toBeLessThan(64)
    })

    test("accepts any content type the released handler accepted and ignores unknown fields", async () => {
      const body = JSON.stringify({ token: "csk-id:1:AAAA", extra: true })
      for (const type of ["application/json; charset=utf-8", "application/json ; charset=UTF-8", "application/jsonx"]) {
        const response = await verify("", body, type)
        expect(response.status).toBe(401)
      }
    })
  })

  describe("enforces fresh authority on every request", () => {
    async function expectStatus(response: Response, status: number, code: string) {
      expect(response.status).toBe(status)
      expectPrivate(response)
      expect(await response.json()).toEqual({ code })
    }

    const anyCode = JSON.stringify({ token: "csk-id:1:AAAA" })

    test("refuses signed-out callers on every endpoint", async () => {
      await expectStatus(await legacyRequest("/api/member-id/session"), 401, "UNAUTHENTICATED")
      await expectStatus(await legacyRequest("/api/member-id/issue", { method: "POST" }), 401, "UNAUTHENTICATED")
      await expectStatus(await verify("", anyCode), 401, "UNAUTHENTICATED")
      await expectStatus(await verify("better-auth.session_token=forged.value", anyCode), 401, "UNAUTHENTICATED")
    })

    test("refuses a caller whose session was revoked or expired", async () => {
      const revoked = await createMember()
      const revokedCookie = await signIn(revoked.email)
      await signOut(revokedCookie)
      const issue = await legacyRequest("/api/member-id/issue", { method: "POST", cookie: revokedCookie })
      await expectStatus(issue, 401, "UNAUTHENTICATED")

      const expired = await createMember()
      const expiredCookie = await signIn(expired.email)
      await t.db
        .update(session)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(session.userId, expired.id))
      await expectStatus(
        await legacyRequest("/api/member-id/session", { cookie: expiredCookie }),
        401,
        "UNAUTHENTICATED"
      )
    })

    test("refuses an Inactive User's existing session", async () => {
      const admin = await createMember({ role: "admin" })
      const cookie = await signIn(admin.email)

      await t.db.update(user).set({ banned: true }).where(eq(user.id, admin.id))

      await expectStatus(await legacyRequest("/api/member-id/session", { cookie }), 401, "UNAUTHENTICATED")
      await expectStatus(
        await legacyRequest("/api/member-id/issue", { method: "POST", cookie }),
        401,
        "UNAUTHENTICATED"
      )
      await expectStatus(await verify(cookie, anyCode), 401, "UNAUTHENTICATED")
    })

    test("refuses to issue a code for an impersonated session", async () => {
      const admin = await createMember({ role: "admin" })
      const member = await createMember()
      const cookie = await signIn(member.email)

      await t.db.update(session).set({ impersonatedBy: admin.id }).where(eq(session.userId, member.id))

      await expectStatus(
        await legacyRequest("/api/member-id/issue", { method: "POST", cookie }),
        401,
        "UNAUTHENTICATED"
      )
    })

    test("refuses verification by a non-Admin before looking at the code", async () => {
      const member = await createMember()
      const cookie = await signIn(member.email)

      await expectStatus(await verify(cookie, JSON.stringify({ token: await issueCode(cookie) })), 403, "FORBIDDEN")
      await expectStatus(await verify(cookie, JSON.stringify({ token: "garbage" })), 403, "FORBIDDEN")
    })

    test("applies role changes on the next request without signing in again", async () => {
      const member = await createMember()
      const code = JSON.stringify({ token: await issueCode(await signIn(member.email)) })
      const admin = await createMember({ role: "admin" })
      const adminCookie = await signIn(admin.email)
      expect((await verify(adminCookie, code)).status).toBe(200)

      await t.db.update(user).set({ role: "user" }).where(eq(user.id, admin.id))

      await expectStatus(await verify(adminCookie, code), 403, "FORBIDDEN")
      const demoted = await legacyRequest("/api/member-id/session", { cookie: adminCookie })
      expect((await demoted.json()).canVerify).toBe(false)

      await t.db.update(user).set({ role: "admin" }).where(eq(user.id, admin.id))
      expect((await verify(adminCookie, code)).status).toBe(200)
    })
  })

  test("answers an unexpected failure with UNAVAILABLE and logs no code, cookie or identity", async () => {
    const failing = createApi({
      ...createApiDependencies({ auth, database: t.db, secret }),
      resolveRequest: async () => {
        throw new Error("connection refused while reading csk-id:1:SECRET")
      }
    })
    const logError = logger.error as Mock<typeof logger.error>
    logError.mockClear()

    const response = await failing.request(`${origin}/api/member-id/verify`, {
      method: "POST",
      headers: { origin, cookie: "better-auth.session_token=private", "content-type": "application/json" },
      body: JSON.stringify({ token: "csk-id:1:SECRET" })
    })

    expect(response.status).toBe(503)
    expectPrivate(response)
    expect(await response.json()).toEqual({ code: "UNAVAILABLE" })
    expect(logError.mock.calls).toEqual([["member_id.request_failed"]])
  })
})

import { afterAll, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { createAuth } from "@/core/auth/create-auth"
import { session, user } from "@/core/db/schema/auth"
import { createApiDependencies } from "@/core/http"
import { createTestDatabase } from "../../test/database"
import { createApi } from "./app"

const database = await createTestDatabase()
const origin = "http://localhost:3000"
const password = "auth-boundary-test-password"
const secret = "auth-boundary-disposable-test-secret"

describe.skipIf(!database)("API auth boundary over HTTP", () => {
  const t = database as NonNullable<typeof database>
  afterAll(() => t.drop())

  const auth = createAuth({
    database: t.db,
    baseURL: origin,
    production: false,
    secret,
    // Better Auth otherwise skips origin checks in NODE_ENV=test.
    advanced: { disableOriginCheck: false }
  })
  const api = createApi(createApiDependencies({ auth, database: t.db, secret }))

  function request(path: string, init: { method?: string; body?: object; headers?: Record<string, string> } = {}) {
    return api.request(`${origin}${path}`, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: { origin, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
      body: init.body ? JSON.stringify(init.body) : undefined
    })
  }

  async function createMember(role: "user" | "admin" = "user") {
    const email = `${crypto.randomUUID()}@example.test`
    const created = await auth.api.createUser({ body: { email, password, name: "Singer", role } })
    return { id: created.user.id, email }
  }

  async function signIn(email: string) {
    const response = await request("/api/auth/sign-in/email", { body: { email, password } })
    expect(response.status).toBe(200)
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ")
    return { response, cookie }
  }

  test("signs in with the existing session cookies and resolves the actor", async () => {
    const member = await createMember()

    const { response, cookie } = await signIn(member.email)
    const sessionCookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("better-auth.session_token="))
    expect(sessionCookie).toContain("HttpOnly")
    expect(sessionCookie).toContain("SameSite=Lax")

    const me = await request("/api/v1/me", { headers: { cookie } })
    expect(me.status).toBe(200)
    expect(await me.json()).toEqual({ userId: member.id, isAdmin: false, impersonatedBy: null })

    const betterAuthSession = await request("/api/auth/get-session", { headers: { cookie } })
    expect(await betterAuthSession.json()).toMatchObject({ user: { id: member.id } })
  })

  test("keeps sign-up Invite-only", async () => {
    const email = `${crypto.randomUUID()}@example.test`

    const response = await request("/api/auth/sign-up/email", { body: { email, password, name: "Uninvited" } })

    expect(response.ok).toBe(false)
    expect(await t.db.select().from(user).where(eq(user.email, email))).toEqual([])
  })

  test("rejects auth requests from untrusted origins", async () => {
    const member = await createMember()

    const response = await request("/api/auth/sign-in/email", {
      body: { email: member.email, password },
      headers: { origin: "https://attacker.example", cookie: "csk-origin-test=1" }
    })

    expect(response.status).toBe(403)
    expect(response.headers.getSetCookie()).toEqual([])
  })

  test("applies sign-out on the next protected operation despite the cookie cache", async () => {
    const member = await createMember()
    const { cookie } = await signIn(member.email)
    expect((await request("/api/v1/me", { headers: { cookie } })).status).toBe(200)

    expect((await request("/api/auth/sign-out", { body: {}, headers: { cookie } })).status).toBe(200)

    const me = await request("/api/v1/me", { headers: { cookie } })
    expect(me.status).toBe(401)
    expect(await me.json()).toEqual({ code: "UNAUTHENTICATED" })
  })

  test("refuses an expired session", async () => {
    const member = await createMember()
    const { cookie } = await signIn(member.email)

    await t.db
      .update(session)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(session.userId, member.id))

    expect((await request("/api/v1/me", { headers: { cookie } })).status).toBe(401)
  })

  test("refuses an Inactive User's existing session on the next protected operation", async () => {
    const member = await createMember()
    const { cookie } = await signIn(member.email)

    await t.db.update(user).set({ banned: true }).where(eq(user.id, member.id))

    expect((await request("/api/v1/me", { headers: { cookie } })).status).toBe(401)
  })

  test("keeps Admin impersonation unavailable", async () => {
    const admin = await createMember("admin")
    const member = await createMember()
    const { cookie } = await signIn(admin.email)

    const response = await request("/api/auth/admin/impersonate-user", {
      body: { userId: member.id },
      headers: { cookie }
    })

    expect(response.status).toBe(403)
    expect(await t.db.select().from(session).where(eq(session.userId, member.id))).toEqual([])
  })

  test("reports a stored impersonation in the actor facts", async () => {
    const admin = await createMember("admin")
    const member = await createMember()
    const { cookie } = await signIn(member.email)

    await t.db.update(session).set({ impersonatedBy: admin.id }).where(eq(session.userId, member.id))

    expect(await (await request("/api/v1/me", { headers: { cookie } })).json()).toEqual({
      userId: member.id,
      isAdmin: false,
      impersonatedBy: admin.id
    })
  })
})

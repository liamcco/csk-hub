import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { eq } from "drizzle-orm"
import { createAuth } from "@/core/auth/create-auth"
import { account, user } from "@/core/db/schema/auth"
import { createTestDatabase } from "../../test/database"
import { bootstrapAdmin, recoverAdmin } from "./admin"

const database = await createTestDatabase()
const origin = "http://localhost:3000"

describe.skipIf(!database)("admin bootstrap and recovery", () => {
  const t = database as NonNullable<typeof database>
  afterAll(() => t.drop())

  const auth = createAuth({
    database: t.db,
    baseURL: origin,
    production: true,
    secret: "admin-cli-disposable-test-secret"
  })

  // EMAIL_MODE=log delivers by printing the message; that is the email the person would receive.
  let consoleLog: ReturnType<typeof spyOn<Console, "log">>
  beforeEach(() => {
    consoleLog = spyOn(console, "log").mockImplementation(() => {})
  })
  afterEach(() => consoleLog.mockRestore())

  function sentEmails() {
    return consoleLog.mock.calls
      .filter(([tag]: unknown[]) => tag === "[email:log]")
      .map(([, message]: unknown[]) => message as { to: string; subject: string; body: string })
  }

  const never = async () => {
    throw new Error("No question was expected.")
  }

  function uniqueEmail() {
    return `${crypto.randomUUID()}@example.test`
  }

  test("creates the named Admin without a password and sends an activation invitation", async () => {
    const email = uniqueEmail()

    expect(await bootstrapAdmin({ auth, database: t.db, email, name: "First Admin", confirm: never })).toEqual({
      kind: "invited"
    })

    const [created] = await t.db.select().from(user).where(eq(user.email, email))
    expect(created).toMatchObject({ name: "First Admin", role: "admin", emailVerified: false, banned: false })
    const credentials = await t.db
      .select({ password: account.password })
      .from(account)
      .where(eq(account.userId, created?.id as string))
    expect(credentials.every(({ password }) => !password)).toBe(true)

    const [invitation] = sentEmails()
    expect(invitation?.to).toBe(email)
    expect(invitation?.body).toContain(`${origin}/api/auth/magic-link/verify?token=`)
    expect(invitation?.body).toContain("callbackURL=%2Factivate")
  })

  test("does not refuse just because another Admin exists", async () => {
    await bootstrapAdmin({ auth, database: t.db, email: uniqueEmail(), name: "One", confirm: never })
    const second = uniqueEmail()

    expect(await bootstrapAdmin({ auth, database: t.db, email: second, name: "Two", confirm: never })).toEqual({
      kind: "invited"
    })
  })

  test("offers to resend the activation to an Admin who has not activated yet", async () => {
    const email = uniqueEmail()
    await bootstrapAdmin({ auth, database: t.db, email, name: "Pending", confirm: never })
    consoleLog.mockClear()
    const questions: string[] = []

    const outcome = await bootstrapAdmin({
      auth,
      database: t.db,
      email,
      name: "Pending",
      confirm: async (question) => {
        questions.push(question)
        return true
      }
    })

    expect(outcome).toEqual({ kind: "activation-resent" })
    expect(questions).toEqual([expect.stringContaining("Resend the activation email")])
    expect(sentEmails().map(({ to }) => to)).toEqual([email])
    expect(await t.db.select().from(user).where(eq(user.email, email))).toHaveLength(1)
  })

  test("offers a recovery email to an activated Admin, and sends nothing when declined", async () => {
    const email = uniqueEmail()
    await auth.api.createUser({ body: { email, name: "Active", password: "an-admin-password", role: "admin" } })
    await t.db.update(user).set({ emailVerified: true }).where(eq(user.email, email))

    expect(await bootstrapAdmin({ auth, database: t.db, email, name: "Active", confirm: async () => false })).toEqual({
      kind: "unchanged"
    })
    expect(sentEmails()).toEqual([])

    expect(await bootstrapAdmin({ auth, database: t.db, email, name: "Active", confirm: async () => true })).toEqual({
      kind: "recovery-sent"
    })
    const [recovery] = sentEmails()
    expect(recovery?.to).toBe(email)
    expect(recovery?.body).toContain(`${origin}/api/auth/reset-password/`)
  })

  test("refuses to promote an existing non-admin; that stays a separate operation", async () => {
    const email = uniqueEmail()
    await auth.api.createUser({ body: { email, name: "Member", role: "user" } })

    expect(await bootstrapAdmin({ auth, database: t.db, email, name: "Member", confirm: never })).toEqual({
      kind: "refused",
      reason: "not-admin"
    })
    const [unchanged] = await t.db.select().from(user).where(eq(user.email, email))
    expect(unchanged?.role).toBe("user")
    expect(sentEmails()).toEqual([])
  })

  test("recover sends a password-reset email to an existing Admin", async () => {
    const email = uniqueEmail()
    await auth.api.createUser({ body: { email, name: "Locked out", password: "an-admin-password", role: "admin" } })

    expect(await recoverAdmin({ auth, database: t.db, email: email.toUpperCase() })).toEqual({ kind: "recovery-sent" })

    const [recovery] = sentEmails()
    expect(recovery?.to).toBe(email)
    expect(recovery?.body).toContain(`${origin}/api/auth/reset-password/`)
  })

  test("recover refuses anyone who is not an Admin, and a deactivated Admin", async () => {
    const member = uniqueEmail()
    await auth.api.createUser({ body: { email: member, name: "Member", role: "user" } })
    const deactivated = uniqueEmail()
    await auth.api.createUser({ body: { email: deactivated, name: "Gone", role: "admin" } })
    await t.db.update(user).set({ banned: true }).where(eq(user.email, deactivated))

    expect(await recoverAdmin({ auth, database: t.db, email: member })).toEqual({
      kind: "refused",
      reason: "not-admin"
    })
    expect(await recoverAdmin({ auth, database: t.db, email: uniqueEmail() })).toEqual({
      kind: "refused",
      reason: "not-found"
    })
    expect(await recoverAdmin({ auth, database: t.db, email: deactivated })).toEqual({
      kind: "refused",
      reason: "deactivated"
    })
    expect(sentEmails()).toEqual([])
  })
})

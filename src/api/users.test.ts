import { afterAll, describe, expect, test } from "bun:test"
import {
  activateUser,
  changeUserRoles,
  deactivateUser,
  eraseUser,
  findExistingUserEmails,
  getCurrentCapabilities,
  importUsers,
  inviteUser,
  listUsers,
  resendInvitation
} from "../../contract/client"
import { createApiHarness } from "../../test/api"
import { createTestDatabase } from "../../test/database"

const database = await createTestDatabase()

function invitee(name = "Invited Ines") {
  return { name, email: `${crypto.randomUUID()}@example.test` }
}

describe.skipIf(!database)("User administration over HTTP", () => {
  const t = database as NonNullable<typeof database>
  afterAll(() => t.drop())
  const h = createApiHarness(t)

  test("lists every User to an Admin and refuses an ordinary member", async () => {
    const admin = await h.signedIn({ role: "admin" })
    const member = await h.signedIn({ name: "Listed Lisa" })

    const users = await listUsers({ client: admin.client })
    expect(users.data?.items).toContainEqual(
      expect.objectContaining({ id: member.member.id, name: "Listed Lisa", hasPassword: true, inactive: false })
    )
    expect((await listUsers({ client: member.client })).response?.status).toBe(403)
    expect((await inviteUser({ client: member.client, body: invitee() })).response?.status).toBe(403)
  })

  test("invites a User who has no password until activation, and refuses a taken or malformed email", async () => {
    const admin = await h.signedIn({ role: "admin" })
    const input = invitee()

    const invited = await inviteUser({ client: admin.client, body: input })
    expect(invited.response?.status).toBe(201)
    expect(invited.data).toMatchObject({ delivery: "sent" })
    const userId = invited.data?.id ?? ""
    expect((await listUsers({ client: admin.client })).data?.items).toContainEqual(
      expect.objectContaining({ id: userId, email: input.email, hasPassword: false })
    )

    const again = await inviteUser({ client: admin.client, body: { ...input, email: input.email.toUpperCase() } })
    expect(again.response?.status).toBe(409)
    expect(again.error).toEqual({ code: "EMAIL_EXISTS" })
    const malformed = await inviteUser({ client: admin.client, body: { name: "No Mail", email: "not-an-email" } })
    expect(malformed.error).toEqual({ code: "EMAIL_INVALID" })
    const unnamed = await inviteUser({ client: admin.client, body: { name: " ", email: invitee().email } })
    expect(unnamed.error).toEqual({ code: "NAME_REQUIRED" })

    expect((await resendInvitation({ client: admin.client, path: { userId } })).data).toEqual({ id: userId })
    const existing = await findExistingUserEmails({
      client: admin.client,
      body: { emails: [` ${input.email.toUpperCase()} `, "nobody@example.test"] }
    })
    expect(existing.data).toEqual({ emails: [input.email] })
  })

  test("deactivation signs a User out on the next request, and only an inactive User can be erased", async () => {
    const admin = await h.signedIn({ role: "admin" })
    const member = await h.signedIn({ name: "Leaving Leo" })
    const userId = member.member.id

    expect((await deactivateUser({ client: admin.client, path: { userId } })).data).toEqual({ id: userId })
    expect((await getCurrentCapabilities({ client: member.client })).response?.status).toBe(401)
    expect((await deactivateUser({ client: admin.client, path: { userId } })).error).toEqual({
      code: "ALREADY_INACTIVE"
    })

    const mistyped = await eraseUser({ client: admin.client, path: { userId }, body: { confirmation: "delete Leo" } })
    expect(mistyped.error).toEqual({ code: "CONFIRMATION_MISMATCH" })
    expect((await activateUser({ client: admin.client, path: { userId } })).data).toEqual({ id: userId })
    const active = await eraseUser({
      client: admin.client,
      path: { userId },
      body: { confirmation: "delete Leaving Leo" }
    })
    expect(active.error).toEqual({ code: "DEACTIVATE_FIRST" })

    await deactivateUser({ client: admin.client, path: { userId } })
    const erased = await eraseUser({
      client: admin.client,
      path: { userId },
      body: { confirmation: "delete Leaving Leo" }
    })
    expect(erased.data).toEqual({ id: userId })
    expect((await listUsers({ client: admin.client })).data?.items.some((item) => item.id === userId)).toBe(false)
    expect((await activateUser({ client: admin.client, path: { userId } })).response?.status).toBe(404)
  })

  test("keeps an Admin from acting on their own account", async () => {
    const admin = await h.signedIn({ role: "admin" })
    const userId = admin.member.id

    expect((await deactivateUser({ client: admin.client, path: { userId } })).error).toEqual({
      code: "CANNOT_CHANGE_SELF"
    })
    expect(
      (await changeUserRoles({ client: admin.client, path: { userId }, body: { roles: ["user"] } })).error
    ).toEqual({ code: "CANNOT_CHANGE_SELF" })
    expect((await resendInvitation({ client: admin.client, path: { userId } })).error).toEqual({
      code: "ALREADY_ACTIVATED"
    })
  })

  test("a promoted member administers Users on their next request", async () => {
    const admin = await h.signedIn({ role: "admin" })
    const member = await h.signedIn()
    const userId = member.member.id

    const promoted = await changeUserRoles({
      client: admin.client,
      path: { userId },
      body: { roles: ["user", "admin"] }
    })
    expect(promoted.data).toEqual({ id: userId })
    expect((await listUsers({ client: member.client })).response?.status).toBe(200)

    await changeUserRoles({ client: admin.client, path: { userId }, body: { roles: ["user"] } })
    expect((await listUsers({ client: member.client })).response?.status).toBe(403)
  })

  test("imports reviewed rows and reports the ones whose email is taken", async () => {
    const admin = await h.signedIn({ role: "admin" })
    const taken = await h.createMember()
    const fresh = invitee("Imported Ida")

    const imported = await importUsers({
      client: admin.client,
      body: {
        users: [
          { row: 2, ...fresh },
          { row: 3, name: "Taken Tom", email: taken.email }
        ]
      }
    })
    expect(imported.data).toEqual({
      created: [{ row: 2, ...fresh }],
      emailFailed: [],
      failed: [{ row: 3, error: "EMAIL_EXISTS" }]
    })
  })
})

import { afterAll, describe, expect, test } from "bun:test"
import { getCurrentCapabilities } from "../../contract/client"
import { createApiHarness } from "../../test/api"
import { createTestDatabase } from "../../test/database"

const database = await createTestDatabase()

const none = {
  admin: false,
  administerUsers: false,
  manageOrganisation: false,
  administerEvents: false,
  broadcastNotifications: false
}

describe.skipIf(!database)("Current User capabilities over HTTP", () => {
  const t = database as NonNullable<typeof database>
  afterAll(() => t.drop())
  const h = createApiHarness(t)

  test("describes an ordinary member without administrative capabilities", async () => {
    const { client, member } = await h.signedIn({ name: "Ordinary Olle" })

    const { data, response } = await getCurrentCapabilities({ client })

    expect(response?.status).toBe(200)
    expect(response?.headers.get("cache-control")).toBe("private, no-store")
    expect(data).toEqual({ user: { id: member.id, name: "Ordinary Olle", image: null }, permissions: none })
  })

  test("grants an Admin every administrative capability", async () => {
    const { client } = await h.signedIn({ role: "admin" })

    const { data } = await getCurrentCapabilities({ client })

    expect(data?.permissions).toEqual({
      admin: true,
      administerUsers: true,
      manageOrganisation: true,
      administerEvents: true,
      broadcastNotifications: true
    })
  })

  test("reflects a role change on the very next request", async () => {
    const { client, member } = await h.signedIn({ role: "admin" })
    expect((await getCurrentCapabilities({ client })).data?.permissions.admin).toBe(true)

    await h.setAccount(member.id, { role: "user" })

    expect((await getCurrentCapabilities({ client })).data?.permissions).toEqual(none)
  })

  test("refuses a deactivated member", async () => {
    const { client, member } = await h.signedIn()
    await h.setAccount(member.id, { banned: true })

    const { response, error } = await getCurrentCapabilities({ client })

    expect(response?.status).toBe(401)
    expect(error).toEqual({ code: "UNAUTHENTICATED" })
  })
})

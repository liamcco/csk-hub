import { afterAll, describe, expect, test } from "bun:test"
import { registerPushSubscription, searchBroadcastRecipients, sendBroadcast } from "@csk-hub/contract/client"
import { createApiHarness } from "../../test/api"
import { createTestDatabase } from "../../test/database"

const database = await createTestDatabase()

describe.skipIf(!database)("Admin broadcasts over HTTP", () => {
  const t = database as NonNullable<typeof database>
  afterAll(() => t.drop())
  const h = createApiHarness(t)

  test("keeps broadcasts to Admins", async () => {
    const member = await h.signedIn()

    expect((await sendBroadcast({ client: member.client, body: { message: "Hello" } })).response?.status).toBe(403)
    expect((await searchBroadcastRecipients({ client: member.client, query: {} })).response?.status).toBe(403)
  })

  test("finds recipients with an active push subscription by name, and leaves out inactive Users", async () => {
    const admin = await h.signedIn({ role: "admin" })
    const subscriber = await h.signedIn({ name: "Pushy Petra" })
    const silent = await h.signedIn({ name: "Pushless Pia" })
    await registerPushSubscription({
      client: subscriber.client,
      body: {
        endpoint: `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`,
        keys: {
          p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
          auth: "tBHItJI5svbpez7KI4CCXg"
        }
      }
    })

    const found = await searchBroadcastRecipients({ client: admin.client, query: { search: "Push" } })
    expect(found.data).toEqual({
      users: [{ id: subscriber.member.id, name: "Pushy Petra", email: subscriber.member.email }],
      requiresPush: true
    })
    expect(found.data?.users.some(({ id }) => id === silent.member.id)).toBe(false)

    await h.setAccount(subscriber.member.id, { banned: true })
    expect((await searchBroadcastRecipients({ client: admin.client, query: { search: "Push" } })).data?.users).toEqual(
      []
    )
  })

  test("reports when no selected recipient can receive push, and refuses an empty broadcast", async () => {
    const admin = await h.signedIn({ role: "admin" })
    const member = await h.createMember()

    const sent = await sendBroadcast({
      client: admin.client,
      body: { message: "  Rehearsal moved  ", userIds: [member.id] }
    })
    expect(sent.data).toEqual({ success: false, error: "noActiveSubscriptions" })

    const empty = await sendBroadcast({ client: admin.client, body: { message: "   " } })
    expect(empty.response?.status).toBe(400)
    expect(empty.error).toEqual({ code: "MESSAGE_REQUIRED" })
    const nobody = await sendBroadcast({ client: admin.client, body: { message: "Hello", userIds: [] } })
    expect(nobody.error).toEqual({ code: "USER_REQUIRED" })
    expect(h.delivery.scheduled).toBe(0)
  })
})

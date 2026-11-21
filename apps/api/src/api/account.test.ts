import { afterAll, describe, expect, test } from "bun:test"
import {
  activateAccount,
  getPushSubscriptionStatus,
  registerPushSubscription,
  removePushSubscription,
  sendTestPushNotification,
  updateLocalePreference
} from "@csk-hub/contract/client"
import { and, eq } from "drizzle-orm"
import { account } from "@/core/db/schema/auth"
import { createApiHarness } from "../../test/api"
import { createTestDatabase } from "../../test/database"

const database = await createTestDatabase()

function browserSubscription() {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`,
    keys: {
      p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
      auth: "tBHItJI5svbpez7KI4CCXg"
    }
  }
}

describe.skipIf(!database)("Account settings over HTTP", () => {
  const t = database as NonNullable<typeof database>
  afterAll(() => t.drop())
  const h = createApiHarness(t)

  test("saves the caller's locale preference and refuses an unsupported one", async () => {
    const member = await h.signedIn()

    const saved = await updateLocalePreference({ client: member.client, body: { locale: "en" } })
    expect(saved.response?.status).toBe(204)

    const unsupported = await updateLocalePreference({ client: member.client, body: { locale: "fr" as "en" } })
    expect(unsupported.response?.status).toBe(400)
    expect((await updateLocalePreference({ client: h.client(), body: { locale: "en" } })).response?.status).toBe(401)
  })

  test("binds a push subscription to its owner only, and removes it once", async () => {
    const owner = await h.signedIn()
    const other = await h.signedIn()
    const subscription = browserSubscription()
    const endpoint = subscription.endpoint

    expect((await getPushSubscriptionStatus({ client: owner.client, body: { endpoint } })).data).toEqual({
      binding: "unbound"
    })
    const registered = await registerPushSubscription({ client: owner.client, body: subscription })
    expect(registered.response?.status).toBe(204)

    expect((await getPushSubscriptionStatus({ client: owner.client, body: { endpoint } })).data).toEqual({
      binding: "bound"
    })
    expect((await getPushSubscriptionStatus({ client: other.client, body: { endpoint } })).data).toEqual({
      binding: "unbound"
    })
    expect((await removePushSubscription({ client: other.client, body: { endpoint } })).data).toEqual({
      removed: false
    })

    expect((await removePushSubscription({ client: owner.client, body: { endpoint } })).data).toEqual({ removed: true })
    expect((await removePushSubscription({ client: owner.client, body: { endpoint } })).data).toEqual({
      removed: false
    })
    expect((await getPushSubscriptionStatus({ client: owner.client, body: { endpoint } })).data).toEqual({
      binding: "unbound"
    })
  })

  test("reports an unsupported push endpoint instead of binding it", async () => {
    const member = await h.signedIn()
    const endpoint = "https://push.example.test/subscription"

    expect((await getPushSubscriptionStatus({ client: member.client, body: { endpoint } })).data).toEqual({
      binding: "unsupported"
    })
    const refused = await registerPushSubscription({
      client: member.client,
      body: { endpoint, keys: { p256dh: "key", auth: "auth" } }
    })
    expect(refused.response?.status).toBe(400)
    expect(refused.error).toEqual({ code: "INVALID_SUBSCRIPTION" })
  })

  test("a test notification without subscriptions reports that nothing was delivered", async () => {
    const member = await h.signedIn()

    const sent = await sendTestPushNotification({ client: member.client, body: { message: "Hello" } })
    expect(sent.data).toEqual({
      success: false,
      error: "noActiveSubscriptions",
      accepted: 0,
      failed: 0,
      failureCategories: {}
    })
  })

  test("stops a deactivated User managing subscriptions on the next request", async () => {
    const member = await h.signedIn()
    await registerPushSubscription({ client: member.client, body: browserSubscription() })

    await h.setAccount(member.member.id, { banned: true })

    const refused = await registerPushSubscription({ client: member.client, body: browserSubscription() })
    expect(refused.response?.status).toBe(401)
    const test = await sendTestPushNotification({ client: member.client, body: { message: "Hello" } })
    expect(test.response?.status).toBe(401)
  })

  test("activation sets an invited User's first password from their magic-link session", async () => {
    const invited = await h.signedIn()
    // An invited User has a session from the magic link but no password yet.
    await t.db.delete(account).where(and(eq(account.userId, invited.member.id), eq(account.providerId, "credential")))
    const password = "correct horse battery staple"

    const mismatch = await activateAccount({
      client: invited.client,
      body: { password, confirmPassword: "another valid password" }
    })
    expect(mismatch.error).toEqual({ code: "PASSWORDS_MISMATCH" })
    const short = await activateAccount({
      client: invited.client,
      body: { password: "short", confirmPassword: "short" }
    })
    expect(short.error).toEqual({ code: "PASSWORD_TOO_SHORT" })

    const activated = await activateAccount({ client: invited.client, body: { password, confirmPassword: password } })
    expect(activated.response?.status).toBe(204)

    const signIn = await h.request("/api/auth/sign-in/email", {
      method: "POST",
      body: { email: invited.member.email, password }
    })
    expect(signIn.status).toBe(200)
  })

  test("activation without a magic-link session is an invalid link", async () => {
    const password = "correct horse battery staple"
    const refused = await activateAccount({ client: h.client(), body: { password, confirmPassword: password } })
    expect(refused.response?.status).toBe(401)
    expect(refused.error).toEqual({ code: "INVALID_LINK" })
  })
})

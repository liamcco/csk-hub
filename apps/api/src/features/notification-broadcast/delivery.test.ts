import { afterEach, beforeEach, describe, expect, jest, mock, spyOn, test } from "bun:test"
import { createECDH } from "node:crypto"
import https from "node:https"

let subscriptions: Record<string, unknown>[] = []
const where = mock(async () => subscriptions)
const select = mock(() => ({ from: () => ({ innerJoin: () => ({ where }) }) }))
const updateWhere = mock(async () => undefined)
const set = mock(() => ({ where: updateWhere }))
const update = mock(() => ({ set }))
const sendNotification = mock(
  async (_subscription: unknown, _payload: string, _options: { agent: https.Agent; timeout: number }): Promise<void> =>
    undefined
)
const getTranslations = mock(async () => {
  throw new Error("Notification actions must not resolve a rendering locale")
})

mock.module("@/core/i18n/server", () => ({ getTranslations }))
mock.module("@/core/db", () => ({
  db: { select, update, transaction: async (run: (tx: unknown) => Promise<unknown>) => run({}) }
}))
mock.module("web-push", () => ({
  default: { setVapidDetails: () => undefined, sendNotification, WebPushError: Error }
}))

const delivery = await import("@/core/notifications/send-push-notification")
mock.module("@/core/notifications", () => ({
  ...delivery,
  listUsersWithActiveSubscriptions: mock(async () => [])
}))
const { db } = await import("@/core/db")
const { notifyUsers, searchNotificationRecipients } = await import("./service")
const broadcast = { database: db, scheduleDelivery: () => {} }

beforeEach(() => {
  subscriptions = []
  getTranslations.mockClear()
  select.mockClear()
  updateWhere.mockClear()
  set.mockClear()
  sendNotification.mockReset()
  sendNotification.mockResolvedValue(undefined)
})

const activeSubscription = {
  id: "subscription-1",
  endpoint: "https://fcm.googleapis.com/fcm/send/test-subscription",
  p256dh: createECDH("prime256v1").generateKeys().toString("base64url"),
  auth: "AAAAAAAAAAAAAAAAAAAAAA",
  failureCount: 0
}

describe("broadcast delivery without a translation context", () => {
  test("recipient search explains that push subscriptions are required without Redis", async () => {
    expect(await searchNotificationRecipients(db, "Singer")).toEqual({ users: [], requiresPush: true })
  })

  test("broadcast returns a delivery error code for the UI to translate", async () => {
    expect(await notifyUsers(broadcast, "Hello")).toEqual({
      success: false,
      error: "noActiveSubscriptions"
    })
    expect(getTranslations).not.toHaveBeenCalled()
  })

  test("selected delivery uses the app title", async () => {
    subscriptions = [activeSubscription]
    expect(await notifyUsers(broadcast, "Hello", ["user-1"])).toEqual({
      success: true,
      delivery: "sent",
      accepted: 1,
      failed: 0,
      failureCategories: {}
    })
    expect(sendNotification).toHaveBeenCalledWith(
      {
        endpoint: activeSubscription.endpoint,
        keys: { p256dh: activeSubscription.p256dh, auth: activeSubscription.auth }
      },
      JSON.stringify({ title: "CSK Hub", body: "Hello" }),
      expect.objectContaining({ agent: expect.any(Object) })
    )
    expect(getTranslations).not.toHaveBeenCalled()
  })

  test("delivery returns noRecipients without querying subscriptions", async () => {
    expect(await delivery.sendToUsers([], { body: "Hello" })).toEqual({
      success: false,
      error: "noRecipients",
      accepted: 0,
      failed: 0,
      failureCategories: {}
    })
    expect(select).not.toHaveBeenCalled()
  })

  test("delivery carries the link and tag a feature sets", async () => {
    subscriptions = [activeSubscription]
    expect(await delivery.sendToUser("user-1", { body: "Hello", url: "/news/post-1", tag: "posts:post-1" })).toEqual({
      success: true,
      accepted: 1,
      failed: 0,
      failureCategories: {}
    })
    expect(sendNotification).toHaveBeenCalledWith(
      expect.anything(),
      JSON.stringify({ title: "CSK Hub", body: "Hello", url: "/news/post-1", tag: "posts:post-1" }),
      expect.objectContaining({ agent: expect.any(Object) })
    )
  })

  test("delivery sends a link as its normalized path", async () => {
    subscriptions = [activeSubscription]
    await delivery.sendToUser("user-1", { body: "Hello", url: "/news/../news/post-1" })
    expect(sendNotification).toHaveBeenCalledWith(
      expect.anything(),
      JSON.stringify({ title: "CSK Hub", body: "Hello", url: "/news/post-1" }),
      expect.anything()
    )
  })

  test("delivery refuses a link that leaves the app", async () => {
    subscriptions = [activeSubscription]
    for (const url of ["https://example.test", "//example.test/news", "/\\example.test/news", "news"]) {
      await expect(delivery.sendToUser("user-1", { body: "Hello", url })).rejects.toThrow("same-origin path")
    }
    expect(sendNotification).not.toHaveBeenCalled()
  })

  test("all failed deliveries return a code and record the provider failure", async () => {
    subscriptions = [activeSubscription]
    sendNotification.mockRejectedValue(Object.assign(new Error("Gone"), { statusCode: 410 }))
    expect(await notifyUsers(broadcast, "Hello")).toEqual({
      success: false,
      error: "deliveryFailed"
    })
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "disabled",
        disabledReason: "Push provider returned HTTP 404 or 410"
      })
    )
    expect(getTranslations).not.toHaveBeenCalled()
  })

  test("a partial delivery still succeeds", async () => {
    subscriptions = [activeSubscription, { ...activeSubscription, id: "subscription-2" }]
    sendNotification.mockRejectedValueOnce(new Error("Provider unavailable"))
    expect(await notifyUsers(broadcast, "Hello")).toEqual({
      success: true,
      delivery: "sent",
      accepted: 1,
      failed: 1,
      failureCategories: { transport: 1 }
    })
    expect(sendNotification).toHaveBeenCalledTimes(2)
  })
})

afterEach(() => jest.useRealTimers())

test("delivery processes the queue with at most five simultaneous sends", async () => {
  subscriptions = Array.from({ length: 7 }, (_, index) => ({ ...activeSubscription, id: `subscription-${index}` }))
  const releases: (() => void)[] = []
  let inFlight = 0
  let maximumInFlight = 0
  sendNotification.mockImplementation(async () => {
    inFlight += 1
    maximumInFlight = Math.max(maximumInFlight, inFlight)
    await new Promise<void>((resolve) => releases.push(resolve))
    inFlight -= 1
  })
  const result = delivery.sendToAll({ body: "Hello" })
  await Bun.sleep(0)
  expect(sendNotification).toHaveBeenCalledTimes(5)
  for (const release of releases.splice(0)) release()
  await Bun.sleep(0)
  expect(sendNotification).toHaveBeenCalledTimes(7)
  for (const release of releases.splice(0)) release()
  expect(await result).toMatchObject({ accepted: 7, failed: 0 })
  expect(maximumInFlight).toBe(5)
})

test("a provider that never settles times out without losing successful deliveries", async () => {
  jest.useFakeTimers()
  subscriptions = [activeSubscription, { ...activeSubscription, id: "subscription-2" }]
  const started = Promise.withResolvers<void>()
  const destroy = spyOn(https.Agent.prototype, "destroy")
  try {
    sendNotification.mockImplementationOnce(() => {
      started.resolve()
      return new Promise<void>(() => undefined)
    })
    const result = delivery.sendToAll({ body: "Hello" })
    await started.promise
    jest.advanceTimersByTime(10_000)
    expect(await result).toMatchObject({ success: true, accepted: 1, failed: 1, failureCategories: { timeout: 1 } })
    expect(destroy).toHaveBeenCalledTimes(2)
  } finally {
    destroy.mockRestore()
  }
})

test("a stalled bookkeeping write cannot turn provider acceptance into a delivery failure", async () => {
  jest.useFakeTimers()
  subscriptions = [activeSubscription]
  const started = Promise.withResolvers<void>()
  updateWhere.mockImplementationOnce(() => {
    started.resolve()
    return new Promise<undefined>(() => undefined)
  })
  const result = delivery.sendToAll({ body: "Hello" })
  await started.promise
  jest.advanceTimersByTime(2_000)
  expect(await result).toMatchObject({ success: true, accepted: 1, failed: 0, failureCategories: { bookkeeping: 1 } })
  expect(sendNotification).toHaveBeenCalledTimes(1)
})

test("stored WNS subscriptions remain deliverable after endpoint validation", async () => {
  subscriptions = [{ ...activeSubscription, endpoint: "https://cloud.notify.windows.com/?token=existing-channel" }]
  expect(await delivery.sendToAll({ body: "Hello" })).toMatchObject({ accepted: 1, failed: 0 })
  expect(set).not.toHaveBeenCalledWith(expect.objectContaining({ status: "disabled" }))
})

test("unsafe stored endpoints are disabled without contacting a provider", async () => {
  subscriptions = [{ ...activeSubscription, endpoint: "https://127.0.0.1/private" }]
  expect(await delivery.sendToAll({ body: "Hello" })).toMatchObject({
    accepted: 0,
    failed: 1,
    failureCategories: { invalidSubscription: 1 }
  })
  expect(sendNotification).not.toHaveBeenCalled()
  expect(set).toHaveBeenCalledWith(
    expect.objectContaining({ status: "disabled", disabledReason: "Stored push subscription failed validation" })
  )
})

test("invalid stored P-256 points are disabled without contacting a provider", async () => {
  subscriptions = [
    { ...activeSubscription, p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]).toString("base64url") }
  ]
  expect(await delivery.sendToAll({ body: "Hello" })).toMatchObject({
    accepted: 0,
    failed: 1,
    failureCategories: { invalidSubscription: 1 }
  })
  expect(sendNotification).not.toHaveBeenCalled()
  expect(set).toHaveBeenCalledWith(
    expect.objectContaining({ status: "disabled", disabledReason: "Stored push subscription failed validation" })
  )
})

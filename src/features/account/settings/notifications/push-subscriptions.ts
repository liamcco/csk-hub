import {
  getPushSubscriptionStatus,
  registerPushSubscription,
  removePushSubscription,
  sendTestPushNotification
} from "@contract/client"
import { browserApiClient as client } from "@/core/api-client/browser"
import { ApiRequestError, type ApiResult } from "@/core/api-client/result"

/** The data of a successful call; anything else rejects, as the settings screen expects. */
async function unwrap<T>(call: Promise<ApiResult<T>>): Promise<T> {
  const { data, error, response } = await call
  if (response?.ok) return data as T
  throw new ApiRequestError(response?.status ?? 0, error)
}

/** Whether this browser's endpoint is bound to the signed-in User, without revealing another owner. */
export async function getPushSubscriptionBinding(endpoint: string) {
  return (await unwrap(getPushSubscriptionStatus({ client, body: { endpoint } }))).binding
}

/** Binds this browser's subscription to the signed-in User. */
export async function subscribeUserToPush(subscription: PushSubscriptionJSON) {
  await unwrap(
    registerPushSubscription({
      client,
      body: {
        endpoint: subscription.endpoint ?? "",
        expirationTime: subscription.expirationTime ?? null,
        keys: { p256dh: subscription.keys?.p256dh ?? "", auth: subscription.keys?.auth ?? "" }
      }
    })
  )
  return { success: true }
}

/** Removes the signed-in User's own binding for the endpoint and reports whether it existed. */
export async function unsubscribeUserFromPush(endpoint: string) {
  const { removed } = await unwrap(removePushSubscription({ client, body: { endpoint } }))
  return { success: true, removed }
}

/** Sends a test notification to the signed-in User's subscriptions. */
export async function sendPushNotificationTest(message: string) {
  return unwrap(sendTestPushNotification({ client, body: { message } }))
}

import { searchBroadcastRecipients, sendBroadcast } from "@contract/client"
import { browserApiClient as client } from "@/core/api-client/browser"
import { ApiRequestError, errorCode } from "@/core/api-client/result"
import type { BroadcastResult } from "./types"

async function broadcast(message: string, userIds?: string[]): Promise<BroadcastResult> {
  const { data, error, response } = await sendBroadcast({ client, body: { message, userIds } })
  if (data) return data
  const code = errorCode(error)
  if (code === "MESSAGE_REQUIRED") return { success: false, error: "messageRequired" }
  if (code === "USER_REQUIRED") return { success: false, error: "userRequired" }
  throw new ApiRequestError(response?.status ?? 0, error)
}

/** Sends an Admin broadcast to every active User through the API. */
export function sendTestNotificationToAll(message: string) {
  return broadcast(message)
}

/** Sends an Admin broadcast to the selected Users through the API. */
export function sendTestNotificationToUsers(userIds: string[], message: string) {
  return broadcast(message, userIds)
}

/** Finds Users a broadcast can reach. */
export async function searchNotificationUsers(search: string) {
  const { data, error, response } = await searchBroadcastRecipients({ client, query: { search } })
  if (data) return data
  throw new ApiRequestError(response?.status ?? 0, error)
}

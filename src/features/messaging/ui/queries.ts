import { getConversation, getConversationUnread, listConversations } from "@contract/client"
import { queryOptions, useQuery } from "@tanstack/react-query"
import { browserApiClient as client } from "@/core/api-client/browser"
import { read } from "@/core/api-client/result"

/** Every Conversation read lives under this key, so a Messaging change refreshes them together. */
export const conversationsKey = ["conversations"] as const

export const inboxQuery = queryOptions({
  queryKey: [...conversationsKey, "inbox"],
  queryFn: async () =>
    (await read(listConversations({ client }))).items.map((item) => ({ ...item, sentAt: new Date(item.sentAt) }))
})

/** A Conversation page; one the caller may not see reads as not found. */
export function conversationQuery(conversationId: string, before?: number) {
  return queryOptions({
    queryKey: [...conversationsKey, "conversation", conversationId, before ?? null],
    queryFn: async () => {
      const page = await read(getConversation({ client, path: { conversationId }, query: { before } }))
      return {
        ...page,
        nextBeforeSequence: page.nextBeforeSequence ?? undefined,
        readToken: page.readToken ?? undefined,
        messages: page.messages.map((item) => ({ ...item, sentAt: new Date(item.sentAt) }))
      }
    }
  })
}

/** Reads `?before=` as a positive Message sequence, ignoring anything else. */
export function beforeSequence(search: Record<string, unknown>) {
  const value = search.before
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined
  const sequence = Number(value)
  return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : undefined
}

export const conversationUnreadQuery = queryOptions({
  queryKey: [...conversationsKey, "unread"],
  queryFn: () => read(getConversationUnread({ client }))
})

/** The caller's unread Conversations, for the navigation badge; undefined while loading. */
export function useConversationUnreadCount() {
  return useQuery(conversationUnreadQuery).data?.count
}

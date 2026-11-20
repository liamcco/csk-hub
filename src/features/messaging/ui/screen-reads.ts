import "server-only"

import { getConversation, getConversationUnread, listConversations } from "@contract/client"
import { cache } from "react"
import { getServerApiClient, readForScreen } from "@/core/api-client/server"
import { conversationPath } from "@/core/navigation/navigation-utils"
import { ROUTES } from "@/core/navigation/site"

export async function readInbox() {
  const inbox = await readForScreen(listConversations({ client: await getServerApiClient() }), ROUTES.messages)
  return inbox.items.map((item) => ({ ...item, sentAt: new Date(item.sentAt) }))
}

/** A Conversation page; one the caller may not see renders as not found. */
export async function readConversation(conversationId: string, before?: number) {
  const client = await getServerApiClient()
  const page = await readForScreen(
    getConversation({ client, path: { conversationId }, query: { before } }),
    conversationPath(conversationId)
  )
  return {
    ...page,
    nextBeforeSequence: page.nextBeforeSequence ?? undefined,
    readToken: page.readToken ?? undefined,
    messages: page.messages.map((item) => ({ ...item, sentAt: new Date(item.sentAt) }))
  }
}

/** The caller's unread Conversations, for the navigation badge; zero when signed out. */
export const countUnreadConversationsForBadge = cache(async () => {
  const { data } = await getConversationUnread({ client: await getServerApiClient() })
  return data?.count ?? 0
})

import "server-only"

import { getEditablePost, getPost, getPostUnread, listLatestPosts, listNewsFeed, listOwnDrafts } from "@contract/client"
import { cache } from "react"
import { getServerApiClient, readForScreen } from "@/core/api-client/server"
import { newsPostEditPath, newsPostPath } from "@/core/navigation/navigation-utils"
import { ROUTES } from "@/core/navigation/site"
import type { RichTextDocument } from "@/features/rich-text/document"

/** Screens render instants as dates and a Post body as the editor's document. */
function published<T extends { publishedAt: string; editedAt: string | null }>(post: T) {
  return {
    ...post,
    publishedAt: new Date(post.publishedAt),
    editedAt: post.editedAt ? new Date(post.editedAt) : null
  }
}

function document(body: { [key: string]: unknown }) {
  return body as RichTextDocument
}

export async function readNewsFeed() {
  const feed = await readForScreen(listNewsFeed({ client: await getServerApiClient() }), ROUTES.news)
  return { ...feed, items: feed.items.map((entry) => ({ ...published(entry), body: document(entry.body) })) }
}

export async function readOwnDrafts() {
  const drafts = await readForScreen(listOwnDrafts({ client: await getServerApiClient() }), ROUTES.news)
  return drafts.items.map((draft) => ({ ...draft, savedAt: new Date(draft.savedAt) }))
}

export async function readLatestPosts(limit: number) {
  const client = await getServerApiClient()
  return (await readForScreen(listLatestPosts({ client, query: { limit } }), ROUTES.home)).items.map(published)
}

export async function readPost(postId: string) {
  const client = await getServerApiClient()
  const view = await readForScreen(getPost({ client, path: { postId } }), newsPostPath(postId))
  return { ...view, post: { ...published(view.post), body: document(view.post.body) } }
}

export async function readEditablePost(postId: string) {
  const client = await getServerApiClient()
  const post = await readForScreen(getEditablePost({ client, path: { postId } }), newsPostEditPath(postId))
  return { ...post, body: document(post.body), savedAt: new Date(post.savedAt) }
}

/** The caller's unread Posts for badges; nothing when signed out. */
export const readPostUnread = cache(async () => {
  const { data } = await getPostUnread({ client: await getServerApiClient() })
  return data ?? { count: 0, nextChangeAt: null }
})

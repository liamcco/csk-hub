import { getEditablePost, getPost, getPostUnread, listLatestPosts, listNewsFeed, listOwnDrafts } from "@contract/client"
import { queryOptions, useQuery } from "@tanstack/react-query"
import { browserApiClient as client } from "@/core/api-client/browser"
import { read } from "@/core/api-client/result"
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

/** Every Post read lives under this key, so a Posts change refreshes them together. */
export const postsKey = ["posts"] as const

export const newsFeedQuery = queryOptions({
  queryKey: [...postsKey, "feed"],
  queryFn: async () => {
    const feed = await read(listNewsFeed({ client }))
    return { ...feed, items: feed.items.map((entry) => ({ ...published(entry), body: document(entry.body) })) }
  }
})

export const ownDraftsQuery = queryOptions({
  queryKey: [...postsKey, "drafts"],
  queryFn: async () =>
    (await read(listOwnDrafts({ client }))).items.map((draft) => ({ ...draft, savedAt: new Date(draft.savedAt) }))
})

export function latestPostsQuery(limit: number) {
  return queryOptions({
    queryKey: [...postsKey, "latest", limit],
    queryFn: async () => (await read(listLatestPosts({ client, query: { limit } }))).items.map(published)
  })
}

export function postQuery(postId: string) {
  return queryOptions({
    queryKey: [...postsKey, "post", postId],
    queryFn: async () => {
      const view = await read(getPost({ client, path: { postId } }))
      return { ...view, post: { ...published(view.post), body: document(view.post.body) } }
    }
  })
}

export function editablePostQuery(postId: string) {
  return queryOptions({
    queryKey: [...postsKey, "editable", postId],
    queryFn: async () => {
      const post = await read(getEditablePost({ client, path: { postId } }))
      return { ...post, body: document(post.body), savedAt: new Date(post.savedAt) }
    },
    // The editor keeps its own state; a background refresh must not reset it.
    staleTime: Number.POSITIVE_INFINITY
  })
}

/** The caller's unread Posts, for the navigation badge and its expiry. */
export const postUnreadQuery = queryOptions({
  queryKey: [...postsKey, "unread"],
  queryFn: () => read(getPostUnread({ client }))
})

/** The caller's unread Post count, for the navigation badge; undefined while loading. */
export function usePostUnreadCount() {
  return useQuery(postUnreadQuery).data?.count
}

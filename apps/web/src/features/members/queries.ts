import { getMemberProfile, getOwnProfile, getProfileEditor, listMembers } from "@csk-hub/contract/client"
import { queryOptions } from "@tanstack/react-query"
import { browserApiClient as client } from "@/core/api-client/browser"
import { read } from "@/core/api-client/result"

/** A member's profile, or the caller's own without an ID. */
export function memberProfileQuery(memberId?: string) {
  return queryOptions({
    queryKey: ["members", "profile", memberId ?? "me"],
    queryFn: () => read(memberId ? getMemberProfile({ client, path: { memberId } }) : getOwnProfile({ client }))
  })
}

/** The caller's voices, for the profile editor. */
export const profileEditorQuery = queryOptions({
  queryKey: ["members", "profile-editor"],
  queryFn: async () => (await read(getProfileEditor({ client }))).voices
})

export type DirectorySearch = { query: string; page: number }

/** Reads a directory search from the page's query string, bounded as the API expects it. */
export function directorySearch(search: Record<string, unknown>): DirectorySearch {
  const requestedPage = typeof search.page === "string" ? Number(search.page) : 1
  return {
    query: typeof search.query === "string" ? search.query.slice(0, 200) : "",
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  }
}

/** One page of the member directory. */
export function directoryQuery(search: DirectorySearch) {
  return queryOptions({
    queryKey: ["members", "directory", search],
    queryFn: () => read(listMembers({ client, query: search }))
  })
}

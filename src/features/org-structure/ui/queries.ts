import { getChoirPlacement, getGroupDetail, getGroupsOverview, listPositionCatalogue } from "@contract/client"
import { queryOptions } from "@tanstack/react-query"
import { browserApiClient as client } from "@/core/api-client/browser"
import { read } from "@/core/api-client/result"
import type { ChoirPlacement } from "./choirs/query"
import type { GroupDetail } from "./detail/query"
import type { GroupsOverview } from "./groups/query"

/** Every organisation read lives under this key, so a change refreshes them together. */
export const organisationKey = ["organisation"] as const

/** The Choirs page's Choirs and Sections. */
export const choirPlacementQuery = queryOptions({
  queryKey: [...organisationKey, "choirs"],
  queryFn: async (): Promise<ChoirPlacement> => (await read(getChoirPlacement({ client }))).choirs
})

export const groupsOverviewQuery = queryOptions({
  queryKey: [...organisationKey, "groups"],
  queryFn: (): Promise<GroupsOverview> => read(getGroupsOverview({ client }))
})

export const positionCatalogueQuery = queryOptions({
  queryKey: [...organisationKey, "positions"],
  queryFn: () => read(listPositionCatalogue({ client }))
})

/** One group's detail page; a missing group reads as not found. */
export function groupDetailQuery(groupId: string) {
  return queryOptions({
    queryKey: [...organisationKey, "group", groupId],
    queryFn: () => read(getGroupDetail({ client, path: { groupId } })) as Promise<GroupDetail>
  })
}

import {
  type ChoirPlacement as ChoirPlacementResponse,
  getChoirPlacement,
  getGroupDetail,
  getGroupsOverview,
  listPositionCatalogue,
  type PositionCatalogue
} from "@contract/client"
import { queryOptions } from "@tanstack/react-query"
import { browserApiClient as client } from "@/core/api-client/browser"
import { read } from "@/core/api-client/result"

export type { GroupDetail, GroupSummary, GroupsOverview } from "@contract/client"
/** Each Choir with its Sections. */
export type ChoirPlacement = ChoirPlacementResponse["choirs"]
export type PositionCatalogueData = PositionCatalogue
export type CataloguePosition = PositionCatalogue["positions"][number]
/** A group a Position can be limited to. */
export type LimitGroup = PositionCatalogue["groups"][number]

/** Every organisation read lives under this key, so a change refreshes them together. */
export const organisationKey = ["organisation"] as const

/** The Choirs page's Choirs and Sections. */
export const choirPlacementQuery = queryOptions({
  queryKey: [...organisationKey, "choirs"],
  queryFn: async () => (await read(getChoirPlacement({ client }))).choirs
})

export const groupsOverviewQuery = queryOptions({
  queryKey: [...organisationKey, "groups"],
  queryFn: () => read(getGroupsOverview({ client }))
})

export const positionCatalogueQuery = queryOptions({
  queryKey: [...organisationKey, "positions"],
  queryFn: () => read(listPositionCatalogue({ client }))
})

/** One group's detail page; a missing group reads as not found. */
export function groupDetailQuery(groupId: string) {
  return queryOptions({
    queryKey: [...organisationKey, "group", groupId],
    queryFn: () => read(getGroupDetail({ client, path: { groupId } }))
  })
}

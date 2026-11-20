import "server-only"

import { getChoirPlacement, getGroupDetail, getGroupsOverview, listPositionCatalogue } from "@contract/client"
import { getServerApiClient, readForScreen } from "@/core/api-client/server"
import { ROUTES } from "@/core/navigation/site"
import type { ChoirPlacement } from "./choirs/query"
import { groupDetailPath } from "./command-state"
import type { GroupDetail } from "./detail/query"
import type { GroupsOverview } from "./groups/query"

/** The Choirs page's Choirs and Sections, read through the API. */
export async function readChoirPlacement(): Promise<ChoirPlacement> {
  const client = await getServerApiClient()
  return (await readForScreen(getChoirPlacement({ client }), ROUTES.adminOrgStructure)).choirs
}

export async function readGroupsOverview(): Promise<GroupsOverview> {
  return readForScreen(getGroupsOverview({ client: await getServerApiClient() }), ROUTES.adminOrgStructureGroups)
}

export async function readPositionCatalogue() {
  return readForScreen(listPositionCatalogue({ client: await getServerApiClient() }), ROUTES.adminOrgStructureGroups)
}

/** One group's detail page; a missing group renders the not-found page. */
export async function readGroupDetail(groupId: string): Promise<GroupDetail> {
  const client = await getServerApiClient()
  return readForScreen(getGroupDetail({ client, path: { groupId } }), groupDetailPath(groupId)) as Promise<GroupDetail>
}

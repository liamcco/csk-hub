import "server-only"

import { getMemberProfile, getOwnProfile, getProfileEditor as getProfileVoices, listMembers } from "@contract/client"
import { getServerApiClient, readForScreen } from "@/core/api-client/server"
import { memberProfilePath } from "@/core/navigation/navigation-utils"
import { ROUTES } from "@/core/navigation/site"

export async function getProfile(memberId?: string) {
  const client = await getServerApiClient()
  return memberId
    ? readForScreen(getMemberProfile({ client, path: { memberId } }), memberProfilePath(memberId))
    : readForScreen(getOwnProfile({ client }), ROUTES.account)
}

export async function getProfileEditor() {
  const client = await getServerApiClient()
  const { voices } = await readForScreen(getProfileVoices({ client }), ROUTES.accountEditProfile)
  return voices
}

export async function getDirectory(query: { query?: string; page?: number }) {
  const client = await getServerApiClient()
  return readForScreen(listMembers({ client, query }), ROUTES.members)
}

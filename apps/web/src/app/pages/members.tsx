import {
  directorySearch,
  EditProfileScreen,
  EditProfileSkeleton,
  MemberDirectoryScreen,
  MemberDirectorySkeleton,
  MemberProfileScreen,
  MemberProfileSkeleton
} from "@/features/members"
import { type Screen, useParam, useSearchLoose } from "../route-hooks"

export const directory: Screen = {
  component: () => <MemberDirectoryScreen search={directorySearch(useSearchLoose())} />,
  pending: MemberDirectorySkeleton
}
export const memberProfile: Screen = {
  component: () => <MemberProfileScreen memberId={useParam("memberId")} />,
  pending: MemberProfileSkeleton
}
export const ownProfile: Screen = { component: () => <MemberProfileScreen />, pending: MemberProfileSkeleton }
export const editProfile: Screen = { component: EditProfileScreen, pending: EditProfileSkeleton }

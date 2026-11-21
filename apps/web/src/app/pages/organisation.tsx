import {
  ChoirsScreen,
  ChoirsScreenSkeleton,
  GroupDetailScreen,
  GroupDetailScreenSkeleton,
  GroupsScreen,
  GroupsScreenSkeleton
} from "@/features/org-structure/ui"
import { type Screen, useParam } from "../route-hooks"

export const choirs: Screen = { component: ChoirsScreen, pending: ChoirsScreenSkeleton }
export const groups: Screen = { component: GroupsScreen, pending: GroupsScreenSkeleton }
export const groupDetail: Screen = {
  component: () => <GroupDetailScreen groupId={useParam("groupId")} />,
  pending: GroupDetailScreenSkeleton
}

import { NotificationManagementScreen } from "@/features/notification-broadcast"
import { UsersScreen, UsersScreenSkeleton } from "@/features/user-management"
import type { Screen } from "../route-hooks"
import { AdminPage } from "./signed-in"

export const adminStart: Screen = { component: AdminPage }
export const users: Screen = { component: UsersScreen, pending: UsersScreenSkeleton }
export const notifications: Screen = { component: NotificationManagementScreen }

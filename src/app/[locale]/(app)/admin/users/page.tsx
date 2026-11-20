import { Suspense } from "react"
import { requireCapability } from "@/core/api-client/capabilities"
import { UsersScreen, UsersScreenSkeleton } from "@/features/user-management"

export const maxDuration = 60

async function AdminUsers() {
  await requireCapability("admin")

  return <UsersScreen />
}

export default function AdminUsersPage() {
  return (
    <Suspense fallback={<UsersScreenSkeleton />}>
      <AdminUsers />
    </Suspense>
  )
}

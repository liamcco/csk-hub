import { Suspense } from "react"
import { requireCapability } from "@/core/api-client/capabilities"
import { GroupsScreen, GroupsScreenSkeleton } from "@/features/org-structure/ui"

async function AdminGroups() {
  await requireCapability("admin")

  return <GroupsScreen />
}

export default function AdminGroupsPage() {
  return (
    <Suspense fallback={<GroupsScreenSkeleton />}>
      <AdminGroups />
    </Suspense>
  )
}

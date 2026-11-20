import { notFound } from "next/navigation"
import { Suspense } from "react"
import { z } from "zod"
import { requireCapability } from "@/core/api-client/capabilities"
import { GroupDetailScreen, GroupDetailScreenSkeleton } from "@/features/org-structure/ui"

const groupIdSchema = z.uuid()

export default function AdminGroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  return (
    <Suspense fallback={<GroupDetailScreenSkeleton />}>
      <AdminGroup params={params} />
    </Suspense>
  )
}

async function AdminGroup({ params }: { params: Promise<{ groupId: string }> }) {
  // Authorize before validating the address, so non-Admins get the same response for any group.
  await requireCapability("admin")
  const { groupId } = await params
  if (!groupIdSchema.safeParse(groupId).success) notFound()

  return <GroupDetailScreen groupId={groupId} />
}

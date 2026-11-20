import { Suspense } from "react"
import { requireCapability } from "@/core/api-client/capabilities"
import { ChoirsScreen, ChoirsScreenSkeleton } from "@/features/org-structure/ui"

async function AdminChoirs() {
  await requireCapability("admin")

  return <ChoirsScreen />
}

export default function AdminChoirsPage() {
  return (
    <Suspense fallback={<ChoirsScreenSkeleton />}>
      <AdminChoirs />
    </Suspense>
  )
}

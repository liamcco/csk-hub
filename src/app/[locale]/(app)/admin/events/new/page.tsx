import { Suspense } from "react"
import { requireCapability } from "@/core/api-client/capabilities"
import { NewEventScreen, NewEventScreenSkeleton } from "@/features/events"

async function AdminNewEvent() {
  await requireCapability("administerEvents")

  return <NewEventScreen />
}

export default function AdminNewEventPage() {
  return (
    <Suspense fallback={<NewEventScreenSkeleton />}>
      <AdminNewEvent />
    </Suspense>
  )
}

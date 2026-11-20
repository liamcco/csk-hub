import { Suspense } from "react"
import { requireCapability } from "@/core/api-client/capabilities"
import { LocationsScreen, LocationsScreenSkeleton } from "@/features/events"

async function AdminEventLocations() {
  await requireCapability("administerEvents")

  return <LocationsScreen />
}

export default function AdminEventLocationsPage() {
  return (
    <Suspense fallback={<LocationsScreenSkeleton />}>
      <AdminEventLocations />
    </Suspense>
  )
}

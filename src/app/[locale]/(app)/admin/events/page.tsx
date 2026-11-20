import { Suspense } from "react"
import { requireCapability } from "@/core/api-client/capabilities"
import { EventsScreen, EventsScreenSkeleton } from "@/features/events"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

async function AdminEvents({ searchParams }: { searchParams: SearchParams }) {
  await requireCapability("administerEvents")

  return <EventsScreen searchParams={await searchParams} />
}

export default function AdminEventsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<EventsScreenSkeleton />}>
      <AdminEvents searchParams={searchParams} />
    </Suspense>
  )
}

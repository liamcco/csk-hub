import "server-only"

import {
  getEventEditor,
  getEventFormOptions,
  getEventPage,
  listLocations,
  listManagedEvents,
  listUpcomingEvents
} from "@contract/client"
import { cache } from "react"
import { getServerApiClient, readForScreen } from "@/core/api-client/server"
import { ROUTES } from "@/core/navigation/site"
import type { RichTextDocument } from "@/features/rich-text/document"
import type { VoiceFamily } from "@/features/voice/model"
import type { UpcomingEvent } from "../calendar/query"
import type { EventStatus, EventType } from "../model"
import { eventManagementPath } from "./command-state"
import type { EventFormValues } from "./editor/query"
import type { EventListFilters } from "./list/query"

function dated<T extends { startsAt: string; endsAt: string }>(item: T) {
  return { ...item, startsAt: new Date(item.startsAt), endsAt: new Date(item.endsAt) }
}

/** The caller's upcoming Events and whether they may create one; shared within a render. */
export const readUpcomingEvents = cache(async () => {
  const upcoming = await readForScreen(listUpcomingEvents({ client: await getServerApiClient() }), ROUTES.events)
  return {
    events: upcoming.items.map((item) => dated(item) as UpcomingEvent),
    canCreate: upcoming.permissions.create
  }
})

export async function readEventPage(eventId: string) {
  const client = await getServerApiClient()
  const page = await readForScreen(getEventPage({ client, path: { eventId } }), `${ROUTES.events}/${eventId}`)
  return {
    ...dated(page),
    type: page.type as EventType,
    status: page.status as UpcomingEvent["status"],
    description: page.description as RichTextDocument | null,
    callTime: page.callTime ? new Date(page.callTime) : null
  }
}

/** Manageable Events and the caller's Events capabilities; shared within a render. */
export const readManagedEvents = cache(
  async (when: EventListFilters["when"], status?: EventStatus, type?: EventType) => {
    const client = await getServerApiClient()
    const managed = await readForScreen(
      listManagedEvents({ client, query: { when, status, type } }),
      ROUTES.eventsManage
    )
    return {
      items: managed.items.map((item) => ({
        ...dated(item),
        type: item.type as EventType,
        status: item.status as EventStatus,
        targets: item.targets.map((target) => ({ ...target, voiceFamily: target.voiceFamily as VoiceFamily | null }))
      })),
      canCreate: managed.permissions.create,
      canAdminister: managed.permissions.administer
    }
  }
)

export async function readEventFormOptions() {
  return readForScreen(getEventFormOptions({ client: await getServerApiClient() }), `${ROUTES.eventsManage}/new`)
}

export async function readEventEditor(eventId: string) {
  const client = await getServerApiClient()
  const editor = await readForScreen(getEventEditor({ client, path: { eventId } }), eventManagementPath(eventId))
  return {
    ...editor,
    status: editor.status as EventStatus,
    values: { ...editor.values, description: editor.values.description as RichTextDocument | null } as EventFormValues
  }
}

export async function readLocations() {
  const locations = await readForScreen(listLocations({ client: await getServerApiClient() }), ROUTES.adminEvents)
  return locations.items
}

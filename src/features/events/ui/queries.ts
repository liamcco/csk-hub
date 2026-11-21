import {
  getEventEditor,
  getEventFormOptions,
  getEventPage,
  listLocations,
  listManagedEvents,
  listUpcomingEvents,
  type UpcomingEvents
} from "@contract/client"
import { queryOptions } from "@tanstack/react-query"
import { browserApiClient as client } from "@/core/api-client/browser"
import { type QueryData, read } from "@/core/api-client/result"
import type { RichTextDocument } from "@/features/rich-text/document"
import type { VoiceFamily } from "@/features/voice/model"
import type { EventStatus, EventType } from "../model"
import type { EventFormValues } from "./editor/form-input"

type Dated<T> = Omit<T, "startsAt" | "endsAt"> & { startsAt: Date; endsAt: Date }

function dated<T extends { startsAt: string; endsAt: string }>(item: T): Dated<T> {
  return { ...item, startsAt: new Date(item.startsAt), endsAt: new Date(item.endsAt) }
}

export type UpcomingEvent = Dated<UpcomingEvents["items"][number]>
export type EventPage = QueryData<ReturnType<typeof eventPageQuery>>
export type EventListRow = QueryData<ReturnType<typeof managedEventsQuery>>["items"][number]
export type EventFormOptions = QueryData<typeof eventFormOptionsQuery>
export type EventDeletionImpact = QueryData<ReturnType<typeof eventEditorQuery>>["impact"]
export type LocationRow = QueryData<typeof locationsQuery>[number]

/** The management list's filters, as its URL carries them. */
export type EventListFilters = {
  /** Upcoming Events have not ended yet; past ones have. */
  when: "upcoming" | "past"
  status?: EventStatus
  type?: EventType
}

/** Every Event and Location read lives under this key, so a change refreshes them together. */
export const eventsKey = ["events"] as const

/** The caller's upcoming Events and whether they may create one. */
export const upcomingEventsQuery = queryOptions({
  queryKey: [...eventsKey, "upcoming"],
  queryFn: async () => {
    const upcoming = await read(listUpcomingEvents({ client }))
    return {
      events: upcoming.items.map((item) => dated(item) as UpcomingEvent),
      canCreate: upcoming.permissions.create
    }
  }
})

export function eventPageQuery(eventId: string) {
  return queryOptions({
    queryKey: [...eventsKey, "page", eventId],
    queryFn: async () => {
      const page = await read(getEventPage({ client, path: { eventId } }))
      return {
        ...dated(page),
        type: page.type as EventType,
        status: page.status as UpcomingEvent["status"],
        description: page.description as RichTextDocument | null,
        callTime: page.callTime ? new Date(page.callTime) : null
      }
    }
  })
}

/** Manageable Events and the caller's Events capabilities. */
export function managedEventsQuery({ when, status, type }: EventListFilters) {
  return queryOptions({
    queryKey: [...eventsKey, "managed", { when, status, type }],
    queryFn: async () => {
      const managed = await read(listManagedEvents({ client, query: { when, status, type } }))
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
  })
}

export const eventFormOptionsQuery = queryOptions({
  queryKey: [...eventsKey, "form-options"],
  queryFn: () => read(getEventFormOptions({ client }))
})

export function eventEditorQuery(eventId: string) {
  return queryOptions({
    queryKey: [...eventsKey, "editor", eventId],
    queryFn: async () => {
      const editor = await read(getEventEditor({ client, path: { eventId } }))
      return {
        ...editor,
        status: editor.status as EventStatus,
        values: {
          ...editor.values,
          description: editor.values.description as RichTextDocument | null
        } as EventFormValues
      }
    },
    // The form keeps its own state; a background refresh must not reset it.
    staleTime: Number.POSITIVE_INFINITY
  })
}

export const locationsQuery = queryOptions({
  queryKey: [...eventsKey, "locations"],
  queryFn: async () => (await read(listLocations({ client }))).items
})

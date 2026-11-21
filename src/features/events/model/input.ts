import type { VoiceFamily } from "@/features/voice/model"
import type { EventType, ParticipationMode } from "./index"
import type { IsoDate } from "./stockholm-time"

/**
 * When an Event happens. A timed Event takes its instants; an all-day Event takes calendar
 * dates, its first and last day, and is stored from 00:00 on the first day to 00:00 on the day
 * after the last, in Europe/Stockholm.
 */
export type EventSchedule =
  | { allDay: false; startsAt: Date; endsAt: Date }
  | { allDay: true; firstDay: IsoDate; lastDay: IsoDate }

/** One rule for who the Event is for: a group, a Voice family, or both. */
export type EventTargetInput = { groupId: string | null; voiceFamily: VoiceFamily | null }

/** One labelled value shown on the Event, such as "Dress code: Kavaj". */
export type EventDetailInput = { label: string; value: string }

/** Everything an Event form saves at once. Optional text that is blank is stored as absent. */
export type EventInput = {
  type: EventType
  title: string
  /** The editor's document, untrusted: parsed through the Events document schema, null when nothing is left to read. */
  description?: unknown
  schedule: EventSchedule
  callTime?: Date | null
  /** Only meaningful when the mode collects something; the database refuses one with mode None. */
  respondBy?: Date | null
  /** Omitted for the type's default. */
  participationMode?: ParticipationMode
  locationId?: string | null
  /** A detail such as "room 3", or a one-off place. */
  locationText?: string | null
  organiserGroupId?: string | null
  /** The fields of the type's extension. Only the ones for `type` are kept; the rest are ignored. */
  rehearsal?: { leaderUserId?: string | null }
  gig?: { responsibleUserId?: string | null; contactName?: string | null; contactDetails?: string | null }
  social?: { costInfo?: string | null }
  /** Who the Event is for. None means everyone in CSK. */
  targets?: EventTargetInput[]
  /** Shown in this order. */
  details?: EventDetailInput[]
}

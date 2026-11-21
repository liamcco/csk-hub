export type { EventDetailInput, EventInput, EventSchedule, EventTargetInput } from "./input"
export { type RehearsalKind, rehearsalKind } from "./rehearsal-kind"
export type { EventResult, EventViolation } from "./result"
export {
  addDays,
  type IsoDate,
  isIsoDate,
  isLocalDateTime,
  type LocalDateTime,
  stockholmDate,
  stockholmInstant,
  stockholmLocalDateTime
} from "./stockholm-time"

/** Every Event type, in the order a picker offers them. The database enum takes this list. */
export const EVENT_TYPES = [
  "Rehearsal",
  "Gig",
  "Concert",
  "Social",
  "Rephelg",
  "Körmöte",
  "Booking", // Reserving a room.
  "Meeting", // Board, committee and other general meetings; a Körmöte is its own type.
  "Other"
] as const

export const EVENT_STATUSES = ["Draft", "Published", "Cancelled"] as const

/** What an Event collects from its audience in advance. The code branches on every value. */
export const PARTICIPATION_MODES = ["None", "ResponseRequired", "ResponseRequiredStrict", "Registration"] as const

export type EventType = (typeof EVENT_TYPES)[number]
export type EventStatus = (typeof EVENT_STATUSES)[number]
export type ParticipationMode = (typeof PARTICIPATION_MODES)[number]

/** The Participation mode an Event of each type starts with, which the organiser may override. */
export const DEFAULT_PARTICIPATION_MODE: Record<EventType, ParticipationMode> = {
  Rehearsal: "ResponseRequiredStrict",
  Gig: "ResponseRequired",
  Concert: "ResponseRequiredStrict",
  Social: "Registration",
  Rephelg: "Registration",
  Körmöte: "ResponseRequired",
  Booking: "None",
  Meeting: "None",
  Other: "None"
}

/** The types with an extension row of their own fields. The others have none. */
export type ExtendedEventType = Extract<EventType, "Rehearsal" | "Gig" | "Social">

export function hasExtension(type: EventType): type is ExtendedEventType {
  return type === "Rehearsal" || type === "Gig" || type === "Social"
}

/** Whether the mode collects anything in advance, and so whether a respond-by deadline means anything. */
export function collectsParticipation(mode: ParticipationMode) {
  return mode !== "None"
}

/**
 * The lifecycle: a Draft is published, a Published Event can be cancelled, and a Cancelled one
 * reinstated. A Published Event never returns to Draft.
 */
const STATUS_CHANGES: Record<EventStatus, readonly EventStatus[]> = {
  Draft: ["Published"],
  Published: ["Cancelled"],
  Cancelled: ["Published"]
}

/** The statuses an Event in `status` can move to. */
export function statusChangesFrom(status: EventStatus): readonly EventStatus[] {
  return STATUS_CHANGES[status]
}

/** Ascending, with absent values last, as SQL orders them. */
export function byPresentValue(a: string | null, b: string | null) {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a.localeCompare(b, "sv")
}

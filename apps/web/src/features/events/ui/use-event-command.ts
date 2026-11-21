import {
  archiveLocation,
  changeEventStatus,
  createEvent,
  createLocation,
  deleteEvent,
  updateEvent,
  updateLocation
} from "@csk-hub/contract/client"
import { readEventForm } from "@csk-hub/shared/features/events/form-input"
import { useCallback } from "react"
import { browserApiClient } from "@/core/api-client/browser"
import { type ApiResult, errorCode, errorKind } from "@/core/api-client/result"
import { useAppRouter } from "@/core/navigation/router"
import { formField, formText as text } from "@/shared/forms/form-data"
import { type EventCommandError, type EventCommandState, eventManagementPath } from "./command-state"

/** Which Events or Locations command a form runs through the API. */
export type EventCommand =
  | { kind: "createEvent" }
  | { kind: "updateEvent"; eventId: string }
  | { kind: "changeEventStatus" }
  | { kind: "deleteEvent" }
  | { kind: "createLocation" }
  | { kind: "updateLocation" }
  | { kind: "archiveLocation" }

type Outcome = ApiResult<{ id: string }>

const client = browserApiClient

function readLocation(formData: FormData) {
  return {
    name: text(formData, "name"),
    address: formField(formData, "address"),
    mapUrl: formField(formData, "mapUrl")
  }
}

function sendEventCommand(command: EventCommand, formData: FormData): Promise<Outcome> {
  switch (command.kind) {
    case "createEvent":
      return createEvent({ client, body: readEventForm(formData) })
    case "updateEvent":
      return updateEvent({ client, path: { eventId: command.eventId }, body: readEventForm(formData) })
    case "changeEventStatus":
      return changeEventStatus({
        client,
        path: { eventId: text(formData, "eventId") },
        body: { status: text(formData, "status") as "Draft" | "Published" | "Cancelled" }
      })
    case "deleteEvent":
      return deleteEvent({ client, path: { eventId: text(formData, "eventId") } })
    case "createLocation":
      return createLocation({ client, body: readLocation(formData) })
    case "updateLocation":
      return updateLocation({
        client,
        path: { locationId: text(formData, "locationId") },
        body: readLocation(formData)
      })
    case "archiveLocation":
      return archiveLocation({ client, path: { locationId: text(formData, "locationId") } })
  }
}

/** Maps the API's `TITLE_REQUIRED` back to the `title-required` the screens translate. */
function eventCommandError({ error, response }: Outcome): EventCommandError {
  const status = response?.status
  if (status === 401 || status === 403) return "access-denied"
  if (status !== 400 && status !== 404) return "unexpected"
  const code = errorCode(error)
  if (!code || code === "VALIDATION_FAILED" || code === "NOT_FOUND") return "invalid-input"
  return errorKind(error) as EventCommandError
}

/**
 * An action for a form or command dialog that runs the command through the API. A new Event
 * opens its page and a saved Event form refreshes its screen; command dialogs refresh or move on
 * themselves once they have shown their success (`EventCommandDialog`).
 */
export function useEventCommand(command: EventCommand) {
  const router = useAppRouter()
  return useCallback(
    async (_state: EventCommandState, formData: FormData): Promise<EventCommandState> => {
      let outcome: Outcome
      try {
        outcome = await sendEventCommand(command, formData)
      } catch {
        return { status: "error", error: "unexpected" }
      }
      if (!outcome.data) return { status: "error", error: eventCommandError(outcome) }
      if (command.kind === "createEvent") router.push(eventManagementPath(outcome.data.id))
      else if (command.kind === "updateEvent") router.refresh()
      return { status: "success", completedAt: Date.now() }
    },
    [command, router]
  )
}

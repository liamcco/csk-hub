"use client"

import {
  archiveLocation,
  changeEventStatus,
  createEvent,
  createLocation,
  deleteEvent,
  updateEvent,
  updateLocation
} from "@contract/client"
import { useCallback } from "react"
import { browserApiClient } from "@/core/api-client/browser"
import { errorCode } from "@/core/api-client/result"
import { type EventCommandError, type EventCommandState, eventManagementPath } from "./command-state"
import { readEventForm } from "./editor/form-input"
import { useAppRouter } from "@/core/navigation/router"

/** Which Events or Locations command a form runs through the API. */
export type EventCommand =
  | { kind: "createEvent" }
  | { kind: "updateEvent"; eventId: string }
  | { kind: "changeEventStatus" }
  | { kind: "deleteEvent" }
  | { kind: "createLocation" }
  | { kind: "updateLocation" }
  | { kind: "archiveLocation" }

type Outcome = { data?: { id: string }; error?: unknown; response?: Response }

const client = browserApiClient

function text(formData: FormData, name: string) {
  const raw = formData.get(name)
  return typeof raw === "string" ? raw : ""
}

function readLocation(formData: FormData) {
  const optional = (name: string) => {
    const raw = formData.get(name)
    return typeof raw === "string" ? raw : undefined
  }
  return { name: text(formData, "name"), address: optional("address"), mapUrl: optional("mapUrl") }
}

function send(command: EventCommand, formData: FormData): Promise<Outcome> {
  switch (command.kind) {
    case "createEvent":
      return createEvent({ client, body: readEventForm(formData) as never })
    case "updateEvent":
      return updateEvent({ client, path: { eventId: command.eventId }, body: readEventForm(formData) as never })
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
function failure({ error, response }: Outcome): EventCommandError {
  const status = response?.status
  if (status === 401 || status === 403) return "access-denied"
  if (status !== 400 && status !== 404) return "unexpected"
  const code = errorCode(error)
  if (!code || code === "VALIDATION_FAILED" || code === "NOT_FOUND") return "invalid-input"
  return code.toLowerCase().replaceAll("_", "-") as EventCommandError
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
        outcome = await send(command, formData)
      } catch {
        return { status: "error", error: "unexpected" }
      }
      if (!outcome.data) return { status: "error", error: failure(outcome) }
      if (command.kind === "createEvent") router.push(eventManagementPath(outcome.data.id))
      else if (command.kind === "updateEvent") router.refresh()
      return { status: "success", completedAt: Date.now() }
    },
    [command, router]
  )
}

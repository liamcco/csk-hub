import { createRoute, z } from "@hono/zod-openapi"
import type { Context } from "hono"
import type { RequestAuthorization } from "@/core/authz/authorization"
import { groupType } from "@/core/db/schema/org-structure"
import { type ApiEnv, createRouter, errorResponses } from "@/core/http"
import type { EventAccessResolver } from "../access"
import { getEventManagementCapabilities, withEventPermission } from "../access"
import { getCurrentEventPage, listCurrentUpcomingEvents } from "../calendar/query"
import { createEvent, updateEvent } from "../events"
import { changeEventStatus, deleteEvent } from "../lifecycle"
import { archiveLocation, createLocation, updateLocation } from "../locations"
import { EVENT_STATUSES, EVENT_TYPES, type EventResult, PARTICIPATION_MODES } from "../model"
import type { EventCommandError } from "../ui/command-state"
import { eventFormSchema } from "../ui/editor/form-input"
import { getEventEditor, getEventFormOptions } from "../ui/editor/query"
import { SHORT_TEXT_MAX_LENGTH, URL_MAX_LENGTH } from "../ui/limits"
import { listManagedEvents } from "../ui/list/query"
import { listLocations } from "../ui/locations/query"

const eventCommandErrors = [
  "event-not-found",
  "title-required",
  "description-invalid",
  "invalid-date",
  "ends-before-start",
  "call-time-after-start",
  "respond-by-after-start",
  "respond-by-without-participation",
  "participation-mode-locked",
  "status-change-not-allowed",
  "location-not-found",
  "location-archived",
  "location-name-required",
  "location-name-taken",
  "invalid-map-url",
  "organiser-group-not-found",
  "organiser-group-archived",
  "target-group-not-found",
  "target-group-archived",
  "target-empty",
  "target-duplicate",
  "detail-incomplete",
  "user-not-found",
  "invalid-input"
] as const satisfies readonly Exclude<EventCommandError, "unexpected" | "access-denied">[]

/** `title-required` travels as `TITLE_REQUIRED`; clients map it back to translate it. */
function eventCode(kind: (typeof eventCommandErrors)[number]) {
  return kind.toUpperCase().replaceAll("-", "_")
}

const EventErrorSchema = z
  .object({
    code: z.enum(eventCommandErrors.map(eventCode) as [string, ...string[]]).openapi({
      description: "Stable Events failure code: a rule the Event or Location broke. Tolerate unknown codes."
    })
  })
  .openapi("EventError")

const instant = () => z.string().openapi({ format: "date-time" })
const nullableText = () => z.string().nullable()
const DocumentSchema = z.record(z.string(), z.unknown()).openapi("EventDescription", {
  description: "The editor's document (ProseMirror JSON) for an Event description."
})
const EventTypeSchema = z.enum(EVENT_TYPES as [string, ...string[]])
const EventStatusSchema = z.enum(EVENT_STATUSES as [string, ...string[]])
const VoiceFamilySchema = z.enum(["S", "A", "T", "B"])

function json<T extends z.ZodType>(description: string, schema: T) {
  return { description, content: { "application/json": { schema } } }
}

function body<T extends z.ZodType>(schema: T) {
  return { body: { required: true, content: { "application/json": { schema } } } }
}

const commandFailures = {
  400: json("The input broke an Event or Location rule.", EventErrorSchema),
  401: errorResponses[401],
  403: errorResponses[403],
  404: json("`EVENT_NOT_FOUND`: no such Event.", EventErrorSchema)
}

const UpcomingEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: EventTypeSchema,
  rehearsalKind: z.enum(["ChoirRehearsal", "ExtraRehearsal", "SectionalRehearsal", "Rehearsal"]).nullable(),
  status: z.enum(["Published", "Cancelled"]),
  startsAt: instant(),
  endsAt: instant(),
  allDay: z.boolean(),
  location: nullableText()
})

const EventPageSchema = UpcomingEventSchema.omit({ location: true })
  .extend({
    canManage: z.boolean(),
    description: DocumentSchema.nullable(),
    callTime: instant().nullable(),
    locationText: nullableText(),
    location: z.object({ name: z.string(), address: nullableText(), mapUrl: nullableText() }).nullable(),
    organiserGroup: nullableText(),
    details: z.array(z.object({ label: z.string(), value: z.string() })),
    leaderName: nullableText(),
    responsibleName: nullableText(),
    costInfo: nullableText(),
    targets: z.array(z.object({ groupName: nullableText(), voiceFamily: VoiceFamilySchema.nullable() }))
  })
  .openapi("EventPage")

const ManagedEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: EventTypeSchema,
  status: EventStatusSchema,
  startsAt: instant(),
  endsAt: instant(),
  allDay: z.boolean(),
  organiserGroup: nullableText(),
  targets: z.array(z.object({ group: nullableText(), voiceFamily: VoiceFamilySchema.nullable() }))
})

const EventFormOptionsSchema = z
  .object({
    canCreate: z.boolean(),
    locations: z.array(z.object({ id: z.string(), name: z.string(), active: z.boolean() })),
    organiserGroups: z.array(
      z.object({ id: z.string(), name: z.string(), type: z.enum(groupType.enumValues), active: z.boolean() })
    ),
    groups: z.array(
      z.object({ id: z.string(), name: z.string(), type: z.enum(groupType.enumValues), active: z.boolean() })
    ),
    users: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        email: z.string().optional().openapi({ description: "Admins only." })
      })
    )
  })
  .openapi("EventFormOptions")

/** The Event form's values: Stockholm wall-clock times (`YYYY-MM-DDTHH:mm`) and calendar dates. */
const EventFormValuesSchema = z
  .object({
    type: EventTypeSchema,
    title: z.string(),
    description: DocumentSchema.nullable(),
    allDay: z.boolean(),
    startsAt: z.string(),
    endsAt: z.string(),
    firstDay: z.string(),
    lastDay: z.string(),
    callTime: z.string(),
    respondBy: z.string(),
    participationMode: z.enum(PARTICIPATION_MODES as [string, ...string[]]),
    locationId: z.string(),
    locationText: z.string(),
    organiserGroupId: z.string(),
    leaderUserId: z.string(),
    responsibleUserId: z.string(),
    contactName: z.string(),
    contactDetails: z.string(),
    costInfo: z.string(),
    targets: z.array(z.object({ groupId: z.string(), voiceFamily: z.string() })),
    details: z.array(z.object({ label: z.string(), value: z.string() }))
  })
  .openapi("EventFormValues")

const EventEditorSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: EventStatusSchema,
    values: EventFormValuesSchema,
    options: EventFormOptionsSchema,
    impact: z.object({ responses: z.int(), registrations: z.int(), attendance: z.int() })
  })
  .openapi("EventEditor")

const optional = () => z.string().optional()

/** The Event form as submitted, before the module's rules apply. Empty fields are omitted. */
const EventInputSchema = z
  .object({
    type: optional(),
    title: z.string(),
    description: optional().openapi({ description: "The description document as a JSON string." }),
    schedule: z.object({
      allDay: z.boolean(),
      startsAt: optional(),
      endsAt: optional(),
      firstDay: optional(),
      lastDay: optional()
    }),
    callTime: optional(),
    respondBy: optional(),
    participationMode: optional(),
    locationId: optional(),
    locationText: optional(),
    organiserGroupId: optional(),
    rehearsal: z.object({ leaderUserId: optional() }),
    gig: z.object({ responsibleUserId: optional(), contactName: optional(), contactDetails: optional() }),
    social: z.object({ costInfo: optional() }),
    targets: z.array(z.object({ groupId: optional(), voiceFamily: optional() })),
    details: z.array(z.object({ label: z.string(), value: z.string() }))
  })
  .openapi("EventInput")

const LocationInputSchema = z
  .object({
    name: z.string().max(SHORT_TEXT_MAX_LENGTH),
    address: z.string().max(SHORT_TEXT_MAX_LENGTH).optional(),
    mapUrl: z.string().max(URL_MAX_LENGTH).optional()
  })
  .openapi("LocationInput")

const LocationSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    address: nullableText(),
    mapUrl: nullableText(),
    active: z.boolean(),
    eventCount: z.int()
  })
  .openapi("Location")

const eventParams = z.object({ eventId: z.uuid() })
const locationParams = z.object({ locationId: z.uuid() })
const Done = z.object({ id: z.string() }).openapi("EventCommandResult")

const routes = {
  listUpcomingEvents: createRoute({
    method: "get",
    path: "/events/upcoming",
    operationId: "listUpcomingEvents",
    summary: "Published and Cancelled Events in the caller's Audience that have not ended, soonest first.",
    tags: ["events"],
    responses: {
      200: json(
        "Upcoming Events.",
        z
          .object({ items: z.array(UpcomingEventSchema), permissions: z.object({ create: z.boolean() }) })
          .openapi("UpcomingEvents")
      ),
      401: errorResponses[401]
    }
  }),
  getEventPage: createRoute({
    method: "get",
    path: "/events/{eventId}",
    operationId: "getEventPage",
    summary: "One Event as its Audience reads it.",
    description: "Drafts, Events outside the caller's Audience and missing Events are all 404.",
    tags: ["events"],
    request: { params: z.object({ eventId: z.string() }) },
    responses: { 200: json("The Event.", EventPageSchema), 401: errorResponses[401], 404: errorResponses[404] }
  }),
  listManagedEvents: createRoute({
    method: "get",
    path: "/events/manage",
    operationId: "listManagedEvents",
    summary: "Events the caller may manage, in any status, with their capabilities.",
    tags: ["events"],
    request: {
      query: z.object({
        when: z.enum(["upcoming", "past"]).default("upcoming"),
        status: EventStatusSchema.optional(),
        type: EventTypeSchema.optional()
      })
    },
    responses: {
      200: json(
        "Manageable Events.",
        z
          .object({
            items: z.array(ManagedEventSchema),
            permissions: z.object({ create: z.boolean(), administer: z.boolean() })
          })
          .openapi("ManagedEvents")
      ),
      400: errorResponses[400],
      401: errorResponses[401]
    }
  }),
  getEventFormOptions: createRoute({
    method: "get",
    path: "/events/manage/options",
    operationId: "getEventFormOptions",
    summary: "What a new Event's form offers the caller.",
    tags: ["events"],
    responses: { 200: json("Form options.", EventFormOptionsSchema), 401: errorResponses[401] }
  }),
  getEventEditor: createRoute({
    method: "get",
    path: "/events/manage/{eventId}",
    operationId: "getEventEditor",
    summary: "One Event as its management page edits it.",
    tags: ["events"],
    request: { params: eventParams },
    responses: {
      200: json("The editor.", EventEditorSchema),
      400: errorResponses[400],
      401: errorResponses[401],
      404: errorResponses[404]
    }
  }),
  createEvent: createRoute({
    method: "post",
    path: "/events/manage",
    operationId: "createEvent",
    summary: "Creates a Draft Event organised by a Group the caller may organise for.",
    tags: ["events"],
    request: body(EventInputSchema),
    responses: { 201: json("The Draft.", Done), ...commandFailures }
  }),
  updateEvent: createRoute({
    method: "put",
    path: "/events/manage/{eventId}",
    operationId: "updateEvent",
    summary: "Saves the whole Event form onto the Event.",
    tags: ["events"],
    request: { params: eventParams, ...body(EventInputSchema) },
    responses: { 200: json("Saved.", Done), ...commandFailures }
  }),
  changeEventStatus: createRoute({
    method: "post",
    path: "/events/manage/{eventId}/status",
    operationId: "changeEventStatus",
    summary: "Publishes, cancels or reinstates an Event.",
    tags: ["events"],
    request: { params: eventParams, ...body(z.object({ status: EventStatusSchema })) },
    responses: { 200: json("Changed.", Done), ...commandFailures }
  }),
  deleteEvent: createRoute({
    method: "delete",
    path: "/events/manage/{eventId}",
    operationId: "deleteEvent",
    summary: "Deletes an Event with everything recorded for it.",
    tags: ["events"],
    request: { params: eventParams },
    responses: { 200: json("Deleted.", Done), ...commandFailures }
  }),
  listLocations: createRoute({
    method: "get",
    path: "/locations",
    operationId: "listLocations",
    summary: "Every Location, active ones first, with how many Events use each. Admins only.",
    tags: ["events"],
    responses: {
      200: json("Locations.", z.object({ items: z.array(LocationSchema) }).openapi("Locations")),
      401: errorResponses[401],
      403: errorResponses[403]
    }
  }),
  createLocation: createRoute({
    method: "post",
    path: "/locations",
    operationId: "createLocation",
    summary: "Adds a Location. Admins only.",
    tags: ["events"],
    request: body(LocationInputSchema),
    responses: { 201: json("The Location.", Done), ...commandFailures }
  }),
  updateLocation: createRoute({
    method: "put",
    path: "/locations/{locationId}",
    operationId: "updateLocation",
    summary: "Changes a Location. Admins only.",
    tags: ["events"],
    request: { params: locationParams, ...body(LocationInputSchema) },
    responses: { 200: json("Saved.", Done), ...commandFailures }
  }),
  archiveLocation: createRoute({
    method: "post",
    path: "/locations/{locationId}/archive",
    operationId: "archiveLocation",
    summary: "Archives a Location; Events that use it keep it. Admins only.",
    tags: ["events"],
    request: { params: locationParams },
    responses: { 200: json("Archived.", Done), ...commandFailures }
  })
}

function resolverOf(authorization: RequestAuthorization): EventAccessResolver {
  return async () => authorization
}

async function caller(c: Context<ApiEnv>) {
  const { authorization } = await c.var.resolveRequest()
  const actor = authorization.requirePermission({ action: "app.access" })
  return { authorization, actor, resolve: resolverOf(authorization) }
}

function iso(date: Date | null) {
  return date ? date.toISOString() : null
}

function failure(c: Context, kind: (typeof eventCommandErrors)[number]) {
  const code = eventCode(kind)
  return kind === "event-not-found" ? c.json({ code }, 404) : c.json({ code }, 400)
}

/** Answers a command's result: its data, or the rule it broke. */
function answer<T, R>(c: Context, result: EventResult<T>, success: (data: T) => R) {
  return result.success ? success(result.data) : failure(c, result.error)
}

/** Runs an Event command after checking the exact Event policy in its write transaction. */
async function eventCommand<T>(
  c: Context<ApiEnv>,
  action: "event.create" | "event.update" | "event.changeStatus" | "event.delete",
  eventId: string | null,
  proposed: { organiserGroupId: string | null } | undefined,
  run: (database: Parameters<Parameters<typeof withEventPermission>[3]>[0], actorId: string) => Promise<EventResult<T>>
) {
  const { resolve } = await caller(c)
  return withEventPermission(action, eventId, proposed, run, c.var.database, resolve)
}

function parseEventInput(input: unknown) {
  const parsed = eventFormSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

/** Events and Locations, mounted under `/api/v1`. */
export const eventsRouter = createRouter()

eventsRouter.openapi(routes.listUpcomingEvents, async (c) => {
  const { resolve } = await caller(c)
  const now = new Date()
  const [upcoming, capabilities] = await Promise.all([
    listCurrentUpcomingEvents(now, c.var.database, resolve),
    getEventManagementCapabilities(c.var.database, resolve)
  ])
  return c.json(
    {
      items: upcoming.events.map((item) => ({
        ...item,
        startsAt: item.startsAt.toISOString(),
        endsAt: item.endsAt.toISOString()
      })),
      permissions: { create: capabilities.canCreate }
    },
    200
  )
})

eventsRouter.openapi(routes.listManagedEvents, async (c) => {
  const { resolve } = await caller(c)
  const query = c.req.valid("query")
  const filters = { when: query.when, status: query.status, type: query.type } as Parameters<
    typeof listManagedEvents
  >[0]
  const [items, capabilities] = await Promise.all([
    listManagedEvents(filters, new Date(), c.var.database, resolve),
    getEventManagementCapabilities(c.var.database, resolve)
  ])
  return c.json(
    {
      items: items.map((item) => ({
        ...item,
        startsAt: item.startsAt.toISOString(),
        endsAt: item.endsAt.toISOString()
      })),
      permissions: { create: capabilities.canCreate, administer: capabilities.canAdminister }
    },
    200
  )
})

eventsRouter.openapi(routes.getEventFormOptions, async (c) => {
  const { resolve } = await caller(c)
  return c.json(await getEventFormOptions({}, c.var.database, resolve), 200)
})

eventsRouter.openapi(routes.getEventEditor, async (c) => {
  const { resolve } = await caller(c)
  const editor = await getEventEditor(c.req.valid("param").eventId, c.var.database, resolve)
  if (!editor) return c.json({ code: "NOT_FOUND" as const }, 404)
  return c.json(editor, 200)
})

eventsRouter.openapi(routes.getEventPage, async (c) => {
  const { resolve } = await caller(c)
  const page = await getCurrentEventPage(c.req.valid("param").eventId, new Date(), c.var.database, resolve)
  if (!page) return c.json({ code: "NOT_FOUND" as const }, 404)
  return c.json(
    {
      ...page,
      description: page.description as Record<string, unknown> | null,
      startsAt: page.startsAt.toISOString(),
      endsAt: page.endsAt.toISOString(),
      callTime: iso(page.callTime)
    },
    200
  )
})

eventsRouter.openapi(routes.createEvent, async (c) => {
  const input = parseEventInput(c.req.valid("json"))
  if (!input) return failure(c, "invalid-input")
  const result = await eventCommand(
    c,
    "event.create",
    null,
    { organiserGroupId: input.organiserGroupId ?? null },
    (database, actorId) => createEvent(database, { ...input, createdBy: actorId })
  )
  return answer(c, result, (data) => c.json({ id: data.id }, 201))
})

eventsRouter.openapi(routes.updateEvent, async (c) => {
  const input = parseEventInput(c.req.valid("json"))
  if (!input) return failure(c, "invalid-input")
  const { eventId } = c.req.valid("param")
  const result = await eventCommand(
    c,
    "event.update",
    eventId,
    { organiserGroupId: input.organiserGroupId ?? null },
    (database) => updateEvent(database, eventId, input)
  )
  return answer(c, result, () => c.json({ id: eventId }, 200))
})

eventsRouter.openapi(routes.changeEventStatus, async (c) => {
  const { eventId } = c.req.valid("param")
  const { status } = c.req.valid("json")
  const result = await eventCommand(c, "event.changeStatus", eventId, undefined, (database) =>
    changeEventStatus(database, eventId, status as (typeof EVENT_STATUSES)[number])
  )
  return answer(c, result, () => c.json({ id: eventId }, 200))
})

eventsRouter.openapi(routes.deleteEvent, async (c) => {
  const { eventId } = c.req.valid("param")
  const result = await eventCommand(c, "event.delete", eventId, undefined, (database) => deleteEvent(database, eventId))
  return answer(c, result, () => c.json({ id: eventId }, 200))
})

async function administrator(c: Context<ApiEnv>) {
  const { authorization } = await c.var.resolveRequest()
  return authorization.requirePermission({ action: "event.administer" })
}

eventsRouter.openapi(routes.listLocations, async (c) => {
  await administrator(c)
  const items = await listLocations(c.var.database, async () => administrator(c))
  return c.json({ items }, 200)
})

eventsRouter.openapi(routes.createLocation, async (c) => {
  await administrator(c)
  const result = await createLocation(c.var.database, c.req.valid("json"))
  return answer(c, result, (data) => c.json({ id: data.id }, 201))
})

eventsRouter.openapi(routes.updateLocation, async (c) => {
  await administrator(c)
  const { locationId } = c.req.valid("param")
  const result = await updateLocation(c.var.database, locationId, c.req.valid("json"))
  return answer(c, result, () => c.json({ id: locationId }, 200))
})

eventsRouter.openapi(routes.archiveLocation, async (c) => {
  await administrator(c)
  const { locationId } = c.req.valid("param")
  const result = await archiveLocation(c.var.database, locationId)
  return answer(c, result, () => c.json({ id: locationId }, 200))
})

import { logger } from "@csk-hub/shared/core/logging"
import {
  ORG_STRUCTURE_VIOLATIONS,
  type OrgStructureResult,
  type OrgStructureViolation
} from "@csk-hub/shared/features/org-structure/model"
import { getErrorCode, getErrorName } from "@csk-hub/shared/shared/errors"
import { createRoute, z } from "@hono/zod-openapi"
import type { Context } from "hono"
import { groupType } from "@/core/db/schema/org-structure"
import { voice } from "@/core/db/schema/voice"
import { type ApiEnv, createRouter, errorResponses } from "@/core/http"
import { changeVoice, endMembership, placeSingerInSection, startMembership } from "../membership"
import type { OrgStructureTransaction } from "../operation"
import { endPositionHolding, replacePositionHolder } from "../positions"
import { archiveGroup, createGroup, createPosition, renameGroup, updatePosition } from "../structure"
import { listPositionCatalogue } from "../ui/catalogue/query"
import { getChoirPlacement } from "../ui/choirs/query"
import { getChoirIdOf, getGroupDetail } from "../ui/detail/query"
import { fields } from "../ui/fields"
import { getGroupsOverview } from "../ui/groups/query"

function json<T extends z.ZodType>(description: string, schema: T) {
  return { description, content: { "application/json": { schema } } }
}

function body<T extends z.ZodType>(schema: T) {
  return { body: { required: true, content: { "application/json": { schema } } } }
}

/** `group-name-taken` travels as `GROUP_NAME_TAKEN`; clients map it back to translate it. */
function violationCode(violation: OrgStructureViolation) {
  return violation.toUpperCase().replaceAll("-", "_")
}

const OrgStructureErrorSchema = z
  .object({
    code: z.enum(ORG_STRUCTURE_VIOLATIONS.map(violationCode) as [string, ...string[]]).openapi({
      description: "The organisation rule a command broke. Tolerate unknown codes."
    })
  })
  .openapi("OrgStructureError")

const GroupTypeSchema = z.enum(groupType.enumValues)
const VoiceSchema = z.enum(voice.enumValues)
const date = () => z.string().openapi({ format: "date" })
const Done = z.object({ id: z.string() }).openapi("OrgStructureCommandResult")

const GroupSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: GroupTypeSchema,
    choirId: z.string().nullable(),
    active: z.boolean(),
    memberCount: z.int(),
    voices: z.array(VoiceSchema),
    holders: z.array(z.object({ position: z.string(), holder: z.string() }))
  })
  .openapi("GroupSummary")

const LimitGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: GroupTypeSchema,
  choirName: z.string().nullable()
})

const GroupDetailSchema = z
  .object({
    group: z.object({
      id: z.string(),
      name: z.string(),
      type: GroupTypeSchema,
      active: z.boolean(),
      choir: z.object({ id: z.string(), name: z.string() }).nullable()
    }),
    sectionVoice: VoiceSchema.nullable(),
    sectionVoices: z.array(VoiceSchema),
    choirVoices: z.array(VoiceSchema),
    members: z.array(
      z.object({
        userId: z.string(),
        name: z.string(),
        email: z.string(),
        startDate: date(),
        voice: VoiceSchema.nullable(),
        positions: z.array(z.string())
      })
    ),
    pastMembers: z.array(
      z.object({
        userId: z.string(),
        name: z.string(),
        startDate: date(),
        endDate: date(),
        voice: VoiceSchema.nullable()
      })
    ),
    positions: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        holder: z.object({ userId: z.string(), name: z.string(), startDate: date() }).nullable()
      })
    ),
    pastHolders: z.array(z.object({ position: z.string(), name: z.string(), startDate: date(), endDate: date() })),
    candidates: z.array(z.object({ id: z.string(), name: z.string(), email: z.string() }))
  })
  .openapi("GroupDetail")

const groupParams = z.object({ groupId: fields.id })
const memberParams = groupParams.extend({ userId: fields.userId })
const holdingParams = groupParams.extend({ positionId: fields.id })
const positionInput = z
  .object({ name: fields.name, groupTypes: z.array(GroupTypeSchema), groupIds: z.array(fields.id) })
  .openapi("PositionInput")

const commandResponses = (success: 200 | 201) => ({
  [success]: json("Done.", Done),
  400: json("The command broke an organisation rule, or the request failed validation.", OrgStructureErrorSchema),
  401: errorResponses[401],
  403: errorResponses[403]
})

const readResponses = <T extends z.ZodType>(description: string, schema: T) => ({
  200: json(description, schema),
  401: errorResponses[401],
  403: errorResponses[403]
})

function command<P extends z.ZodObject, B extends z.ZodType>(
  method: "post" | "put",
  path: string,
  operationId: string,
  summary: string,
  params: P | undefined,
  input: B | undefined,
  success: 200 | 201 = 200
) {
  return createRoute({
    method,
    path,
    operationId,
    summary,
    tags: ["org-structure"],
    request: { ...(params ? { params } : {}), ...(input ? body(input) : {}) } as {
      params: P
      body: ReturnType<typeof body<B>>["body"]
    },
    responses: commandResponses(success)
  })
}

const routes = {
  getChoirPlacement: createRoute({
    method: "get",
    path: "/choirs",
    operationId: "getChoirPlacement",
    summary: "Every Choir with its Sections in score order, archived ones included. Admins only.",
    tags: ["org-structure"],
    responses: readResponses(
      "Choirs.",
      z
        .object({ choirs: z.array(z.object({ choir: GroupSummarySchema, sections: z.array(GroupSummarySchema) })) })
        .openapi("ChoirPlacement")
    )
  }),
  getGroupsOverview: createRoute({
    method: "get",
    path: "/groups",
    operationId: "getGroupsOverview",
    summary: "Every group but the Choirs and their Sections, archived ones included. Admins only.",
    tags: ["org-structure"],
    responses: readResponses(
      "Groups.",
      z
        .object({
          cskWide: z.array(GroupSummarySchema),
          choirs: z.array(z.object({ choir: GroupSummarySchema, groups: z.array(GroupSummarySchema) }))
        })
        .openapi("GroupsOverview")
    )
  }),
  listPositionCatalogue: createRoute({
    method: "get",
    path: "/positions",
    operationId: "listPositionCatalogue",
    summary: "Every Position with its GroupTypes and limit to groups, and the groups a limit can name. Admins only.",
    tags: ["org-structure"],
    responses: readResponses(
      "The catalogue.",
      z
        .object({
          positions: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              groupTypes: z.array(GroupTypeSchema),
              groups: z.array(LimitGroupSchema)
            })
          ),
          groups: z.array(LimitGroupSchema)
        })
        .openapi("PositionCatalogue")
    )
  }),
  getGroupDetail: createRoute({
    method: "get",
    path: "/groups/{groupId}",
    operationId: "getGroupDetail",
    summary: "One group with its members, Positions and history, and who can join it. Admins only.",
    tags: ["org-structure"],
    request: { params: z.object({ groupId: z.string() }) },
    responses: { ...readResponses("The group.", GroupDetailSchema), 404: errorResponses[404] }
  }),
  createGroup: command(
    "post",
    "/groups",
    "createGroup",
    "Creates a CSK-wide group or one of a Choir's groups. Choirs and Sections are not created here.",
    undefined,
    z.object({ name: fields.name, type: fields.creatableGroupType, choirId: fields.id.optional() }),
    201
  ),
  renameGroup: command(
    "post",
    "/groups/{groupId}/name",
    "renameGroup",
    "Renames a group.",
    groupParams,
    z.object({ name: fields.name })
  ),
  archiveGroup: command(
    "post",
    "/groups/{groupId}/archive",
    "archiveGroup",
    "Archives a group, ending its Memberships and Position holdings.",
    groupParams,
    undefined
  ),
  addGroupMember: command(
    "post",
    "/groups/{groupId}/members",
    "addGroupMember",
    "Adds a member; in a Section, `voice` places them as a singer, which makes them a member of the Choir.",
    groupParams,
    z.object({ userId: fields.userId, startDate: fields.date, voice: fields.voice.optional() })
  ),
  endGroupMembership: command(
    "post",
    "/groups/{groupId}/members/{userId}/end",
    "endGroupMembership",
    "Ends a Membership and the member's Position holdings in the group.",
    memberParams,
    z.object({ endDate: fields.date })
  ),
  changeSingerVoice: command(
    "post",
    "/groups/{groupId}/members/{userId}/voice",
    "changeSingerVoice",
    "Changes a singer's Voice in the group's Choir, which may move them to another Section.",
    memberParams,
    z.object({ voice: fields.voice, date: fields.date })
  ),
  assignPositionHolder: command(
    "post",
    "/groups/{groupId}/positions/{positionId}/holder",
    "assignPositionHolder",
    "Gives a Position to a current member, ending any current holder's holding the same day.",
    holdingParams,
    z.object({ userId: fields.userId, startDate: fields.date })
  ),
  endPositionHolding: command(
    "post",
    "/groups/{groupId}/positions/{positionId}/end",
    "endPositionHolding",
    "Ends a member's holding of a Position.",
    holdingParams,
    z.object({ userId: fields.userId, endDate: fields.date })
  ),
  createPosition: command(
    "post",
    "/positions",
    "createPosition",
    "Adds a Position to the catalogue.",
    undefined,
    positionInput,
    201
  ),
  updatePosition: command(
    "put",
    "/positions/{positionId}",
    "updatePosition",
    "Renames a Position and replaces its GroupTypes and limit to groups, as one change.",
    z.object({ positionId: fields.id }),
    positionInput
  )
}

async function administer(c: Context<ApiEnv>) {
  const { authorization } = await c.var.resolveRequest()
  authorization.requirePermission({ action: "org.manage" })
}

/**
 * Authorizes the Admin, then runs one module command in a transaction and answers its typed result:
 * the addressed id, or the rule it broke. Unexpected failures are logged by name only.
 */
async function run(
  c: Context<ApiEnv>,
  name: string,
  id: (data: unknown) => string,
  success: 200 | 201,
  work: (tx: OrgStructureTransaction) => Promise<OrgStructureResult<unknown>>
) {
  await administer(c)
  let result: OrgStructureResult<unknown>
  try {
    result = await c.var.database.transaction((tx) => work(tx))
  } catch (error) {
    logger.error(`admin.org-structure.${name}-failed`, {
      errorCode: getErrorCode(error),
      errorName: getErrorName(error)
    })
    throw error
  }
  if (!result.success) return c.json({ code: violationCode(result.error) }, 400)
  return c.json({ id: id(result.data) }, success)
}

const createdId = (data: unknown) => (data as { id: string }).id

/** Groups, Memberships and Positions administration, mounted under `/api/v1`. */
export const orgStructureRouter = createRouter()

orgStructureRouter.openapi(routes.getChoirPlacement, async (c) => {
  await administer(c)
  return c.json({ choirs: await getChoirPlacement(c.var.database) }, 200)
})

orgStructureRouter.openapi(routes.getGroupsOverview, async (c) => {
  await administer(c)
  return c.json(await getGroupsOverview(c.var.database), 200)
})

orgStructureRouter.openapi(routes.listPositionCatalogue, async (c) => {
  await administer(c)
  return c.json(await listPositionCatalogue(c.var.database), 200)
})

orgStructureRouter.openapi(routes.getGroupDetail, async (c) => {
  await administer(c)
  const { groupId } = c.req.valid("param")
  const detail = fields.id.safeParse(groupId).success ? await getGroupDetail(c.var.database, groupId) : null
  if (!detail) return c.json({ code: "NOT_FOUND" as const }, 404)
  return c.json(detail, 200)
})

orgStructureRouter.openapi(routes.createGroup, async (c) => {
  const input = c.req.valid("json")
  return run(c, "create", createdId, 201, (tx) =>
    createGroup(tx, { name: input.name, type: input.type, choirId: input.choirId ?? null })
  )
})

orgStructureRouter.openapi(routes.renameGroup, async (c) => {
  const { groupId } = c.req.valid("param")
  return run(
    c,
    "rename",
    () => groupId,
    200,
    (tx) => renameGroup(tx, groupId, c.req.valid("json").name)
  )
})

orgStructureRouter.openapi(routes.archiveGroup, async (c) => {
  const { groupId } = c.req.valid("param")
  return run(
    c,
    "archive",
    () => groupId,
    200,
    (tx) => archiveGroup(tx, groupId)
  )
})

orgStructureRouter.openapi(routes.addGroupMember, async (c) => {
  const { groupId } = c.req.valid("param")
  const input = c.req.valid("json")
  return run(
    c,
    "add-member",
    () => groupId,
    200,
    (tx) =>
      input.voice
        ? placeSingerInSection(tx, {
            userId: input.userId,
            sectionId: groupId,
            voice: input.voice,
            startDate: input.startDate
          })
        : startMembership(tx, { userId: input.userId, groupId, startDate: input.startDate })
  )
})

orgStructureRouter.openapi(routes.endGroupMembership, async (c) => {
  const { groupId, userId } = c.req.valid("param")
  const { endDate } = c.req.valid("json")
  return run(
    c,
    "end-membership",
    () => groupId,
    200,
    (tx) => endMembership(tx, { groupId, userId, endDate })
  )
})

orgStructureRouter.openapi(routes.changeSingerVoice, async (c) => {
  const { groupId, userId } = c.req.valid("param")
  const input = c.req.valid("json")
  return run(
    c,
    "change-voice",
    () => groupId,
    200,
    async (tx) => {
      const choirId = await getChoirIdOf(tx, groupId)
      if (!choirId) return { success: false, error: "not-a-singer" }
      return changeVoice(tx, { userId, choirId, voice: input.voice, date: input.date })
    }
  )
})

orgStructureRouter.openapi(routes.assignPositionHolder, async (c) => {
  const { groupId, positionId } = c.req.valid("param")
  const input = c.req.valid("json")
  return run(
    c,
    "assign-holder",
    () => groupId,
    200,
    (tx) => replacePositionHolder(tx, { groupId, positionId, userId: input.userId, startDate: input.startDate })
  )
})

orgStructureRouter.openapi(routes.endPositionHolding, async (c) => {
  const { groupId, positionId } = c.req.valid("param")
  const input = c.req.valid("json")
  return run(
    c,
    "end-holding",
    () => groupId,
    200,
    (tx) => endPositionHolding(tx, { groupId, positionId, userId: input.userId, endDate: input.endDate })
  )
})

orgStructureRouter.openapi(routes.createPosition, async (c) => {
  return run(c, "create-position", createdId, 201, (tx) => createPosition(tx, c.req.valid("json")))
})

orgStructureRouter.openapi(routes.updatePosition, async (c) => {
  const { positionId } = c.req.valid("param")
  return run(
    c,
    "update-position",
    () => positionId,
    200,
    (tx) => updatePosition(tx, { positionId, ...c.req.valid("json") })
  )
})

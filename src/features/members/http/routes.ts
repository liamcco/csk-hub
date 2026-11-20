import { createRoute, z } from "@hono/zod-openapi"
import type { Context } from "hono"
import type { AuthorizationActor, RequestAuthorization } from "@/core/authz"
import { groupType } from "@/core/db/schema/org-structure"
import { voice } from "@/core/db/schema/voice"
import { type ApiEnv, apiError, createRouter, errorResponses } from "@/core/http"
import { findDirectConversation } from "@/features/messaging/reading"
import { VOICE_DIVISIONS } from "@/features/voice/model"
import { getOwnVoiceCapabilities, saveOwnVoiceCapabilities } from "../edit-profile/service"
import { getMemberProfile, InactiveViewerError, listMemberDirectory, requireActiveViewer } from "../service"

const VoiceDivisionSchema = z.enum(VOICE_DIVISIONS)

const DirectoryMemberSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    username: z.string().nullable(),
    image: z.string().nullable(),
    choirs: z.array(z.object({ id: z.string(), name: z.string(), section: z.string().nullable() }))
  })
  .openapi("DirectoryMember")

const MemberDirectorySchema = z
  .object({
    query: z.string().openapi({ description: "The trimmed search that was applied." }),
    page: z.number().int().openapi({ description: "The page served, clamped to the last page." }),
    totalPages: z.number().int(),
    total: z.number().int(),
    items: z.array(DirectoryMemberSchema)
  })
  .openapi("MemberDirectory")

const PositionHoldingSchema = z.object({ groupId: z.string(), positionId: z.string(), name: z.string() })

const MemberGroupFields = z.object({
  groupId: z.string(),
  name: z.string(),
  type: z.enum(groupType.enumValues),
  choirId: z.string().nullable(),
  choirName: z.string().nullable(),
  active: z.boolean(),
  startDate: z.string().openapi({ format: "date" }),
  voice: VoiceDivisionSchema.nullable(),
  sectionVoice: z.enum(voice.enumValues).nullable(),
  positions: z.array(PositionHoldingSchema)
})
const MemberGroupSchema = MemberGroupFields.openapi("MemberGroup")

const MemberProfileSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    username: z.string().nullable(),
    image: z.string().nullable(),
    email: z.string().nullable().openapi({ description: "Only the profile's owner sees an email." }),
    isOwn: z.boolean(),
    capabilities: z.array(VoiceDivisionSchema).openapi({ description: "Self-reported voices the member can sing." }),
    choirs: z.array(
      MemberGroupSchema.extend({ section: MemberGroupFields.nullable(), groups: z.array(MemberGroupSchema) })
    ),
    groups: z.array(MemberGroupSchema),
    otherGroups: z
      .array(MemberGroupSchema)
      .openapi({ description: "Active Groups of an archived Choir, shown with their Choir's name." }),
    positions: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        groups: z.array(z.object({ id: z.string(), name: z.string(), choirName: z.string().nullable() }))
      })
    )
  })
  .openapi("MemberProfile")

const MemberProfileViewSchema = z
  .object({
    profile: MemberProfileSchema,
    permissions: z
      .object({
        editProfile: z.boolean(),
        message: z.boolean().openapi({ description: "Whether the caller may message this member." })
      })
      .openapi({ description: "UI hints for the current User; every operation re-checks authority." }),
    messageConversationId: z
      .string()
      .nullable()
      .openapi({ description: "The existing Direct Conversation with this member, if any." })
  })
  .openapi("MemberProfileView")

const ProfileVoicesSchema = z.object({ voices: z.array(VoiceDivisionSchema) }).openapi("ProfileVoices")

const listMembersRoute = createRoute({
  method: "get",
  path: "/members",
  operationId: "listMembers",
  summary: "Other active members, searched by name or username.",
  description: "Numbered pages of 24, ordered by name, because the directory shows page numbers and a member count.",
  tags: ["members"],
  request: {
    query: z.object({
      query: z.string().max(200).optional(),
      page: z.coerce.number().int().optional().openapi({ type: "integer" })
    })
  },
  responses: {
    200: { description: "One directory page.", content: { "application/json": { schema: MemberDirectorySchema } } },
    400: errorResponses[400],
    401: errorResponses[401]
  }
})

const profileResponses = {
  200: { description: "The profile.", content: { "application/json": { schema: MemberProfileViewSchema } } },
  401: errorResponses[401],
  404: errorResponses[404]
}

const getMemberProfileRoute = createRoute({
  method: "get",
  path: "/members/{memberId}",
  operationId: "getMemberProfile",
  summary: "An active member's profile with the caller's permissions on it.",
  tags: ["members"],
  request: { params: z.object({ memberId: z.string() }) },
  responses: profileResponses
})

const getOwnProfileRoute = createRoute({
  method: "get",
  path: "/profile",
  operationId: "getOwnProfile",
  summary: "The caller's own profile.",
  tags: ["members"],
  responses: profileResponses
})

const getProfileEditorRoute = createRoute({
  method: "get",
  path: "/profile/voices",
  operationId: "getProfileEditor",
  summary: "The caller's editable voices.",
  tags: ["members"],
  responses: {
    200: { description: "The caller's voices.", content: { "application/json": { schema: ProfileVoicesSchema } } },
    401: errorResponses[401],
    403: errorResponses[403]
  }
})

const updateProfileVoicesRoute = createRoute({
  method: "put",
  path: "/profile/voices",
  operationId: "updateProfileVoices",
  summary: "Replaces the voices the caller can sing.",
  tags: ["members"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ voices: z.array(VoiceDivisionSchema).max(VOICE_DIVISIONS.length) })
        }
      }
    }
  },
  responses: {
    200: { description: "The saved voices.", content: { "application/json": { schema: ProfileVoicesSchema } } },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403]
  }
})

async function viewer(c: Context<ApiEnv>) {
  const { authorization } = await c.var.resolveRequest()
  return { authorization, actor: authorization.requirePermission({ action: "app.access" }) }
}

async function profileView(
  c: Context<ApiEnv>,
  { authorization, actor }: { authorization: RequestAuthorization; actor: AuthorizationActor },
  memberId: string
) {
  const database = c.var.database
  const profile = await getMemberProfile(database, actor.userId, memberId)
  const context = { member: profile ? { id: profile.id, banned: profile.banned } : null }
  if (!profile || !authorization.can({ action: "member.read", context }))
    return c.json({ code: "NOT_FOUND" as const }, 404)
  const canMessage = memberId !== actor.userId
  const { banned: _banned, ...visible } = profile
  return c.json(
    {
      profile: { ...visible, email: authorization.can({ action: "member.readEmail", context }) ? profile.email : null },
      permissions: { editProfile: authorization.can({ action: "member.editProfile", context }), message: canMessage },
      messageConversationId: canMessage ? await findDirectConversation(database, actor.userId, memberId) : null
    },
    200
  )
}

/** Member directory, profiles and the caller's own profile edit, mounted under `/api/v1`. */
export const membersRouter = createRouter()

membersRouter.openapi(listMembersRoute, async (c) => {
  const { actor } = await viewer(c)
  const { members, ...page } = await listMemberDirectory(c.var.database, actor.userId, c.req.valid("query"))
  return c.json({ ...page, items: members }, 200)
})

membersRouter.openapi(getMemberProfileRoute, async (c) =>
  profileView(c, await viewer(c), c.req.valid("param").memberId)
)

membersRouter.openapi(getOwnProfileRoute, async (c) => {
  const caller = await viewer(c)
  return profileView(c, caller, caller.actor.userId)
})

membersRouter.openapi(getProfileEditorRoute, async (c) => {
  const { authorization, actor } = await viewer(c)
  const member = await requireActiveViewer(c.var.database, actor.userId)
  authorization.requirePermission({ action: "member.editProfile", context: { member } })
  return c.json({ voices: await getOwnVoiceCapabilities(c.var.database, actor.userId) }, 200)
})

membersRouter.openapi(updateProfileVoicesRoute, async (c) => {
  const { authorization, actor } = await viewer(c)
  const result = await saveOwnVoiceCapabilities(c.var.database, actor, c.req.valid("json").voices, async (request) =>
    authorization.requirePermission(request)
  )
  if (result.status === "success") return c.json({ voices: result.voices }, 200)
  if (result.status === "error" && result.error === "inactive-user")
    return c.json({ code: "UNAUTHENTICATED" as const }, 401)
  return c.json({ code: "VALIDATION_FAILED" as const, issues: [{ path: ["voices"], code: "invalid_value" }] }, 400)
})

membersRouter.onError((error, c) => {
  // The authentication resolver treats inactive Users as signed out; keep that for races too.
  if (error instanceof InactiveViewerError) return apiError(c, 401, "UNAUTHENTICATED")
  throw error
})

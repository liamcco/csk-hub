import { groupMemberIds } from "@csk-hub/shared/features/messaging/model/group-conversation"
import { MessagingAccessError, type MessagingErrorKind } from "@csk-hub/shared/features/messaging/model/messaging-error"
import { createRoute, z } from "@hono/zod-openapi"
import type { Context } from "hono"
import {
  type ApiEnv,
  createRouter,
  domainErrorCode,
  errorResponses,
  instant,
  jsonBody,
  jsonResponse
} from "@/core/http"
import {
  addGroupMembers,
  createGroupConversation,
  leaveGroupConversation,
  renameGroupConversation
} from "../group-conversations"
import type { MessagingContext } from "../model/context"
import { sendMessage, startDirectConversation } from "../sending"
import { getConversationPage } from "../ui/conversation/query"
import { markConversationRead } from "../ui/conversation/read"
import { searchMembers } from "../ui/inbox/member-search"
import { listConversations } from "../ui/inbox/query"
import { countUnreadConversations } from "../unread/service"

const messagingErrorKinds = [
  "group-name-invalid",
  "group-members-too-many",
  "blank-message",
  "message-too-long",
  "sign-in-required",
  "recipient-required",
  "recipient-inactive",
  "idempotency-key-required",
  "idempotency-key-reused",
  "self-recipient",
  "conversation-send-forbidden",
  "group-management-forbidden",
  "conversation-recipient-inactive",
  "conversation-unavailable",
  "conversation-view-forbidden",
  "conversation-not-found",
  "read-position-invalid"
] as const satisfies readonly MessagingErrorKind[]

const MessagingErrorSchema = z
  .object({
    code: z.enum(messagingErrorKinds.map(domainErrorCode) as [string, ...string[]]).openapi({
      description: "Stable Messaging failure code. Clients must tolerate unknown codes."
    })
  })
  .openapi("MessagingError")

const statusOf: Record<MessagingErrorKind, 400 | 401 | 403 | 404 | 409> = {
  "group-name-invalid": 400,
  "group-members-too-many": 400,
  "blank-message": 400,
  "message-too-long": 400,
  "recipient-required": 400,
  "idempotency-key-required": 400,
  "self-recipient": 400,
  "read-position-invalid": 400,
  "sign-in-required": 401,
  "conversation-send-forbidden": 403,
  "group-management-forbidden": 403,
  "conversation-view-forbidden": 403,
  "conversation-unavailable": 404,
  "conversation-not-found": 404,
  "recipient-inactive": 409,
  "conversation-recipient-inactive": 409,
  "idempotency-key-reused": 409
}

function failures<Status extends 400 | 403 | 404 | 409>(...statuses: Status[]) {
  return Object.fromEntries(
    statuses.map((status) => [
      status,
      {
        description: `Messaging codes: ${messagingErrorKinds
          .filter((kind) => statusOf[kind] === status)
          .map((kind) => `\`${domainErrorCode(kind)}\``)
          .join(", ")}.`,
        content: { "application/json": { schema: MessagingErrorSchema } }
      }
    ])
  ) as Record<Status, { description: string; content: { "application/json": { schema: typeof MessagingErrorSchema } } }>
}

const InboxSchema = z
  .object({
    items: z.array(
      z.object({
        kind: z.enum(["direct", "group"]),
        id: z.string(),
        otherMemberName: z
          .string()
          .nullable()
          .openapi({ description: "The other member, or the Group Conversation's name; null after Erasure." }),
        preview: z.string().nullable(),
        sentAt: instant(),
        unreadCount: z.int(),
        canSend: z.boolean().openapi({ description: "False after departure or when the other member is inactive." })
      })
    )
  })
  .openapi("Inbox")

const ConversationPageSchema = z
  .object({
    kind: z.enum(["direct", "group"]),
    conversationId: z.string(),
    otherMemberName: z.string().nullable(),
    otherMemberProfileId: z.string().nullable().openapi({ description: "Direct only: the active member's id." }),
    canSend: z.boolean(),
    members: z.array(z.object({ id: z.string(), name: z.string() })),
    messages: z.array(
      z.object({
        id: z.string(),
        sequence: z.int(),
        text: z.string(),
        sentAt: instant(),
        authorUserId: z.string().nullable(),
        authorName: z.string().nullable(),
        isOwnMessage: z.boolean()
      })
    ),
    hasOlder: z.boolean(),
    nextBeforeSequence: z.int().nullable(),
    newestSequence: z.int(),
    readToken: z
      .string()
      .nullable()
      .openapi({ description: "Proves the caller saw `newestSequence`; required to mark it read." })
  })
  .openapi("ConversationPage")

const conversationParams = z.object({ conversationId: z.string() })
const ConversationRefSchema = z.object({ conversationId: z.string() }).openapi("ConversationRef")

const routes = {
  listConversations: createRoute({
    method: "get",
    path: "/conversations",
    operationId: "listConversations",
    summary: "The caller's Direct and Group Conversations, most recent first.",
    description: "A departed member keeps the history retained for them, read-only.",
    tags: ["messaging"],
    responses: { 200: jsonResponse("The inbox.", InboxSchema), 401: errorResponses[401] }
  }),
  getConversationUnread: createRoute({
    method: "get",
    path: "/conversations/unread",
    operationId: "getConversationUnread",
    summary: "How many of the caller's Conversations hold an unread Message.",
    tags: ["messaging"],
    responses: {
      200: jsonResponse("The unread count.", z.object({ count: z.int() }).openapi("ConversationUnread")),
      401: errorResponses[401]
    }
  }),
  searchMessageRecipients: createRoute({
    method: "get",
    path: "/conversations/recipients",
    operationId: "searchMessageRecipients",
    summary: "Other active members to start a Conversation with, by name or username.",
    tags: ["messaging"],
    request: { query: z.object({ query: z.string().max(200).default("") }) },
    responses: {
      200: jsonResponse(
        "Up to 20 members.",
        z
          .object({ items: z.array(z.object({ id: z.string(), name: z.string(), username: z.string().nullable() })) })
          .openapi("MessageRecipients")
      ),
      400: errorResponses[400],
      401: errorResponses[401]
    }
  }),
  getConversation: createRoute({
    method: "get",
    path: "/conversations/{conversationId}",
    operationId: "getConversation",
    summary: "A window of up to 50 Messages, oldest first, ending before `before` when given.",
    tags: ["messaging"],
    request: {
      params: conversationParams,
      query: z.object({ before: z.coerce.number().int().min(1).optional().openapi({ type: "integer" }) })
    },
    responses: {
      200: jsonResponse("The Conversation page.", ConversationPageSchema),
      400: errorResponses[400],
      401: errorResponses[401],
      ...failures(403, 404)
    }
  }),
  startConversation: createRoute({
    method: "post",
    path: "/conversations",
    operationId: "startConversation",
    summary: "Starts a Direct Conversation with a first Message (one member) or a named Group Conversation.",
    description:
      "Retrying with the same `idempotencyKey` returns the original Conversation instead of creating another.",
    tags: ["messaging"],
    request: jsonBody(
      z.object({
        memberIds: z.array(z.string()).min(1),
        text: z.string().optional().openapi({ description: "The first Message; required for a Direct Conversation." }),
        name: z.string().optional().openapi({ description: "Required for a Group Conversation." }),
        idempotencyKey: z.string()
      })
    ),
    responses: {
      200: jsonResponse("The Conversation.", ConversationRefSchema),
      401: errorResponses[401],
      ...failures(400, 403, 404, 409)
    }
  }),
  sendMessage: createRoute({
    method: "post",
    path: "/conversations/{conversationId}/messages",
    operationId: "sendMessage",
    summary: "Appends a Message. Retrying with the same `idempotencyKey` returns the original Message.",
    description: "Reusing a key for different text is `IDEMPOTENCY_KEY_REUSED`.",
    tags: ["messaging"],
    request: { params: conversationParams, ...jsonBody(z.object({ text: z.string(), idempotencyKey: z.string() })) },
    responses: {
      200: jsonResponse(
        "The Message; `created` is false for a retry.",
        z
          .object({ conversationId: z.string(), id: z.string(), sequence: z.int(), created: z.boolean() })
          .openapi("SentMessage")
      ),
      401: errorResponses[401],
      ...failures(400, 403, 404, 409)
    }
  }),
  markConversationRead: createRoute({
    method: "post",
    path: "/conversations/{conversationId}/read",
    operationId: "markConversationRead",
    summary: "Advances the caller's read cursor to a Message they were shown.",
    tags: ["messaging"],
    request: { params: conversationParams, ...jsonBody(z.object({ sequence: z.int(), token: z.string() })) },
    responses: {
      200: jsonResponse(
        "Whether the cursor moved.",
        z.object({ changed: z.boolean() }).openapi("ConversationReadResult")
      ),
      401: errorResponses[401],
      ...failures(400, 403)
    }
  }),
  addGroupMembers: createRoute({
    method: "post",
    path: "/conversations/{conversationId}/members",
    operationId: "addGroupMembers",
    summary: "Adds members to a Group Conversation the caller belongs to.",
    tags: ["messaging"],
    request: { params: conversationParams, ...jsonBody(z.object({ memberIds: z.array(z.string()).min(1) })) },
    responses: {
      200: jsonResponse("The Conversation.", ConversationRefSchema),
      401: errorResponses[401],
      ...failures(400, 403, 404, 409)
    }
  }),
  renameGroupConversation: createRoute({
    method: "put",
    path: "/conversations/{conversationId}/name",
    operationId: "renameGroupConversation",
    summary: "Renames a Group Conversation the caller belongs to.",
    tags: ["messaging"],
    request: { params: conversationParams, ...jsonBody(z.object({ name: z.string() })) },
    responses: {
      200: jsonResponse("The Conversation.", ConversationRefSchema),
      401: errorResponses[401],
      ...failures(400, 403, 404)
    }
  }),
  leaveGroupConversation: createRoute({
    method: "post",
    path: "/conversations/{conversationId}/leave",
    operationId: "leaveGroupConversation",
    summary: "Leaves a Group Conversation. History up to departure stays visible, read-only.",
    tags: ["messaging"],
    request: { params: conversationParams },
    responses: {
      200: jsonResponse("The Conversation.", ConversationRefSchema),
      401: errorResponses[401],
      ...failures(403, 404)
    }
  })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Conversation ids are UUIDs; anything else names no Conversation. */
function conversationId(c: Context<ApiEnv>) {
  const id = c.req.param("conversationId") ?? ""
  if (!UUID.test(id)) throw new MessagingAccessError("conversation-not-found")
  return id
}

async function caller(c: Context<ApiEnv>) {
  const { authorization } = await c.var.resolveRequest()
  const actor = authorization.requirePermission({ action: "app.access" })
  const context: MessagingContext = {
    database: c.var.database,
    authorize: async (request) => authorization.requirePermission(request)
  }
  return { actor, context }
}

/** Direct and Group Conversations, Messages and unread state, mounted under `/api/v1`. */
export const messagingRouter = createRouter()

messagingRouter.openapi(routes.listConversations, async (c) => {
  const { context } = await caller(c)
  const items = await listConversations(context)
  return c.json({ items: items.map((item) => ({ ...item, sentAt: item.sentAt.toISOString() })) }, 200)
})

messagingRouter.openapi(routes.getConversationUnread, async (c) => {
  const { actor } = await caller(c)
  return c.json({ count: await countUnreadConversations(c.var.database, actor.userId) }, 200)
})

messagingRouter.openapi(routes.searchMessageRecipients, async (c) => {
  const { context } = await caller(c)
  return c.json({ items: await searchMembers(c.req.valid("query").query, context) }, 200)
})

messagingRouter.openapi(routes.getConversation, async (c) => {
  const { context } = await caller(c)
  const page = await getConversationPage(conversationId(c), c.req.valid("query").before, context)
  return c.json(
    {
      ...page,
      otherMemberProfileId: page.kind === "direct" ? page.otherMemberProfileId : null,
      messages: page.messages.map((item) => ({
        ...item,
        authorUserId: item.authorUserId ?? null,
        authorName: item.authorName ?? null,
        sentAt: item.sentAt.toISOString()
      })),
      nextBeforeSequence: page.nextBeforeSequence ?? null,
      readToken: page.readToken ?? null
    },
    200
  )
})

messagingRouter.openapi(routes.startConversation, async (c) => {
  const { context } = await caller(c)
  const input = c.req.valid("json")
  const memberIds = groupMemberIds(input.memberIds)
  const result =
    memberIds.length === 1
      ? await startDirectConversation(
          { recipientId: memberIds[0], text: input.text, idempotencyKey: input.idempotencyKey },
          context
        )
      : await createGroupConversation({ name: input.name, memberIds, idempotencyKey: input.idempotencyKey }, context)
  if (!("created" in result) || result.created) c.var.scheduleDelivery()
  return c.json({ conversationId: result.conversationId }, 200)
})

messagingRouter.openapi(routes.sendMessage, async (c) => {
  const { context } = await caller(c)
  const input = c.req.valid("json")
  const result = await sendMessage({ conversationId: conversationId(c), ...input }, context)
  if (result.created) c.var.scheduleDelivery()
  return c.json(
    { conversationId: result.conversationId, id: result.id, sequence: result.sequence, created: result.created },
    200
  )
})

messagingRouter.openapi(routes.markConversationRead, async (c) => {
  const { context } = await caller(c)
  const { sequence, token } = c.req.valid("json")
  const changed = await markConversationRead(conversationId(c), sequence, token, context)
  if (changed) c.var.scheduleDelivery()
  return c.json({ changed }, 200)
})

messagingRouter.openapi(routes.addGroupMembers, async (c) => {
  const { context } = await caller(c)
  const result = await addGroupMembers(
    { conversationId: conversationId(c), memberIds: c.req.valid("json").memberIds },
    context
  )
  c.var.scheduleDelivery()
  return c.json(result, 200)
})

messagingRouter.openapi(routes.renameGroupConversation, async (c) => {
  const { context } = await caller(c)
  const result = await renameGroupConversation(
    { conversationId: conversationId(c), name: c.req.valid("json").name },
    context
  )
  c.var.scheduleDelivery()
  return c.json(result, 200)
})

messagingRouter.openapi(routes.leaveGroupConversation, async (c) => {
  const { context } = await caller(c)
  const result = await leaveGroupConversation(conversationId(c), context)
  c.var.scheduleDelivery()
  return c.json(result, 200)
})

messagingRouter.onError((error, c) => {
  if (error instanceof MessagingAccessError) return c.json({ code: domainErrorCode(error.kind) }, statusOf[error.kind])
  throw error
})

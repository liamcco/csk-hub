import { POST_TITLE_MAX_LENGTH } from "@csk-hub/shared/features/posts/compose/schemas"
import { postDocument } from "@csk-hub/shared/features/posts/post-document"
import { createRoute, z } from "@hono/zod-openapi"
import type { Context } from "hono"
import type { RequestAuthorization } from "@/core/authz/authorization"
import { type ApiEnv, createRouter, errorResponses, instant, jsonBody, jsonResponse } from "@/core/http"
import {
  createPostCommand,
  discardDraftCommand,
  editPublishedPostCommand,
  type PostCommandContext,
  type PostWriteResult,
  saveDraftCommand,
  unpublishPostCommand
} from "../compose/commands"
import {
  type Authorize,
  getEditablePost,
  getPublishedPost,
  listLatestPosts,
  listNewsFeed,
  listOwnDrafts
} from "../service"
import { countUnreadPosts, listUnreadPostIds, markPostRead, nextUnreadPostChangeAt } from "../unread/service"

const RichTextDocumentSchema = z.record(z.string(), z.unknown()).openapi("RichTextDocument", {
  description: "The editor's document (ProseMirror JSON), restricted to what a Post body may contain."
})

const PublishedPostSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    authorName: z.string().nullable().openapi({ description: "Null once the author has been erased." }),
    publishedAt: instant(),
    editedAt: instant().nullable().openapi({ description: "When the title or body last changed after publishing." }),
    body: RichTextDocumentSchema
  })
  .openapi("PublishedPost")

const NewsFeedSchema = z
  .object({
    items: z.array(PublishedPostSchema.extend({ unread: z.boolean() })).openapi({ description: "Newest first." }),
    permissions: z.object({ create: z.boolean() })
  })
  .openapi("NewsFeed")

const LatestPostsSchema = z.object({ items: z.array(PublishedPostSchema.omit({ body: true })) }).openapi("LatestPosts")

const OwnDraftsSchema = z
  .object({ items: z.array(z.object({ id: z.string(), title: z.string(), savedAt: instant() })) })
  .openapi("OwnDrafts")

const PostUnreadSchema = z
  .object({
    count: z.int().openapi({ description: "Published Posts from the last 30 days the User has not opened." }),
    nextChangeAt: instant()
      .nullable()
      .openapi({ description: "When the count next changes without a write: a publication or a 30-day expiry." })
  })
  .openapi("PostUnread")

const PostViewSchema = z
  .object({
    post: PublishedPostSchema,
    permissions: z.object({ update: z.boolean(), unpublish: z.boolean() })
  })
  .openapi("PostView")

const EditablePostSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    body: RichTextDocumentSchema,
    state: z.enum(["draft", "published"]),
    savedAt: instant()
  })
  .openapi("EditablePost")

const PostContentSchema = z.object({
  title: z.string().trim().min(1).max(POST_TITLE_MAX_LENGTH),
  body: RichTextDocumentSchema
})

const SavedPostSchema = z.object({ id: z.string() }).openapi("SavedPost")

const postIdParams = z.object({ postId: z.string() })

const writeFailures = {
  400: errorResponses[400],
  401: errorResponses[401],
  403: errorResponses[403],
  404: errorResponses[404],
  500: { description: "`INTERNAL`: the write failed and nothing was saved.", content: errorResponses[401].content }
}

const routes = {
  listNewsFeed: createRoute({
    method: "get",
    path: "/posts",
    operationId: "listNewsFeed",
    summary: "The whole News feed, newest first, with the caller's unread marks.",
    tags: ["posts"],
    responses: { 200: jsonResponse("The feed.", NewsFeedSchema), 401: errorResponses[401] }
  }),
  listLatestPosts: createRoute({
    method: "get",
    path: "/posts/latest",
    operationId: "listLatestPosts",
    summary: "The newest published Posts without their bodies, for overviews.",
    tags: ["posts"],
    request: { query: z.object({ limit: z.coerce.number().int().min(1).max(20).default(3) }) },
    responses: {
      200: jsonResponse("The newest Posts.", LatestPostsSchema),
      400: errorResponses[400],
      401: errorResponses[401]
    }
  }),
  listOwnDrafts: createRoute({
    method: "get",
    path: "/posts/drafts",
    operationId: "listOwnDrafts",
    summary: "The caller's own Drafts, most recently saved first. Never anyone else's.",
    tags: ["posts"],
    responses: { 200: jsonResponse("The caller's Drafts.", OwnDraftsSchema), 401: errorResponses[401] }
  }),
  getPostUnread: createRoute({
    method: "get",
    path: "/posts/unread",
    operationId: "getPostUnread",
    summary: "The caller's unread Post count and when it next changes by itself.",
    tags: ["posts"],
    responses: { 200: jsonResponse("Unread state.", PostUnreadSchema), 401: errorResponses[401] }
  }),
  getPost: createRoute({
    method: "get",
    path: "/posts/{postId}",
    operationId: "getPost",
    summary: "A published Post with the caller's permissions on it.",
    description: "Drafts, Recalled Posts and discarded Posts are 404, even to their author.",
    tags: ["posts"],
    request: { params: postIdParams },
    responses: { 200: jsonResponse("The Post.", PostViewSchema), 401: errorResponses[401], 404: errorResponses[404] }
  }),
  getEditablePost: createRoute({
    method: "get",
    path: "/posts/{postId}/edit",
    operationId: "getEditablePost",
    summary: "A Post as the caller may edit it: their own Draft, or a published Post they may change.",
    description: "Another author's Draft is 404, including to Admins.",
    tags: ["posts"],
    request: { params: postIdParams },
    responses: {
      200: jsonResponse("The Post.", EditablePostSchema),
      401: errorResponses[401],
      404: errorResponses[404]
    }
  }),
  createPost: createRoute({
    method: "post",
    path: "/posts",
    operationId: "createPost",
    summary: "Writes a new Post, published at once or kept as the caller's Draft.",
    tags: ["posts"],
    request: jsonBody(PostContentSchema.extend({ publish: z.boolean() })),
    responses: { 201: jsonResponse("The new Post.", SavedPostSchema), ...writeFailures }
  }),
  saveDraft: createRoute({
    method: "put",
    path: "/posts/{postId}/draft",
    operationId: "saveDraft",
    summary: "Saves the caller's own Draft, and publishes it when `publish` is true.",
    tags: ["posts"],
    request: { params: postIdParams, ...jsonBody(PostContentSchema.extend({ publish: z.boolean() })) },
    responses: { 200: jsonResponse("The saved Post.", SavedPostSchema), ...writeFailures }
  }),
  editPublishedPost: createRoute({
    method: "put",
    path: "/posts/{postId}/published",
    operationId: "editPublishedPost",
    summary: "Changes a published Post in place; marked edited only when something changed.",
    tags: ["posts"],
    request: { params: postIdParams, ...jsonBody(PostContentSchema) },
    responses: { 200: jsonResponse("The saved Post.", SavedPostSchema), ...writeFailures }
  }),
  recallPost: createRoute({
    method: "post",
    path: "/posts/{postId}/recall",
    operationId: "recallPost",
    summary: "Recalls a published Post from the feed back to its author's Drafts.",
    tags: ["posts"],
    request: { params: postIdParams },
    responses: {
      200: jsonResponse(
        "Whose Drafts received the Post.",
        z.object({ id: z.string(), unpublishedTo: z.enum(["own", "author"]) }).openapi("RecalledPost")
      ),
      ...writeFailures
    }
  }),
  discardDraft: createRoute({
    method: "post",
    path: "/posts/{postId}/discard",
    operationId: "discardDraft",
    summary: "Throws the caller's own Draft away for good. It is hidden, never deleted.",
    tags: ["posts"],
    request: { params: postIdParams },
    responses: { 204: { description: "Discarded." }, ...writeFailures }
  }),
  markPostRead: createRoute({
    method: "post",
    path: "/posts/{postId}/read",
    operationId: "markPostRead",
    summary: "Records that the caller opened a published Post. Idempotent.",
    tags: ["posts"],
    request: { params: postIdParams },
    responses: {
      200: jsonResponse(
        "Whether this was the first time, so a client can skip refreshing unchanged badges.",
        z.object({ changed: z.boolean() }).openapi("PostReadResult")
      ),
      401: errorResponses[401]
    }
  })
}

function iso(date: Date) {
  return date.toISOString()
}

function published<T extends { publishedAt: Date; editedAt: Date | null }>(entry: T) {
  return { ...entry, publishedAt: iso(entry.publishedAt), editedAt: entry.editedAt ? iso(entry.editedAt) : null }
}

function authorizeWith(authorization: RequestAuthorization): Authorize {
  return async (request) => authorization.requirePermission(request)
}

async function caller(c: Context<ApiEnv>) {
  const { authorization } = await c.var.resolveRequest()
  const actor = authorization.requirePermission({ action: "app.access" })
  const context: PostCommandContext = { database: c.var.database, authorize: authorizeWith(authorization) }
  return { authorization, actor, context }
}

function invalidBody(c: Context) {
  return c.json({ code: "VALIDATION_FAILED" as const, issues: [{ path: ["body"], code: "invalid_value" }] }, 400)
}

/** Answers a write's failure with a stable code; null when it succeeded. */
function writeFailure(c: Context, result: PostWriteResult<object>) {
  if (result.status === "unauthorized") return c.json({ code: "FORBIDDEN" as const }, 403)
  if (result.status === "unavailable") return c.json({ code: "NOT_FOUND" as const }, 404)
  if (result.status === "failed") return c.json({ code: "INTERNAL" as const }, 500)
  return null
}

/** The News feed, Posts and their lifecycle, and unread state, mounted under `/api/v1`. */
export const postsRouter = createRouter()

postsRouter.openapi(routes.listNewsFeed, async (c) => {
  const { authorization, actor, context } = await caller(c)
  const [entries, unread] = await Promise.all([
    listNewsFeed(context.database, context.authorize),
    listUnreadPostIds(context.database, actor.userId)
  ])
  return c.json(
    {
      items: entries.map((entry) => ({ ...published(entry), unread: unread.has(entry.id) })),
      permissions: { create: authorization.can({ action: "post.create" }) }
    },
    200
  )
})

postsRouter.openapi(routes.listLatestPosts, async (c) => {
  const { context } = await caller(c)
  const posts = await listLatestPosts(c.req.valid("query").limit, context.database, context.authorize)
  return c.json({ items: posts.map(published) }, 200)
})

postsRouter.openapi(routes.listOwnDrafts, async (c) => {
  const { context } = await caller(c)
  const drafts = await listOwnDrafts(context.database, context.authorize)
  return c.json({ items: drafts.map((draft) => ({ ...draft, savedAt: iso(draft.savedAt) })) }, 200)
})

postsRouter.openapi(routes.getPostUnread, async (c) => {
  const { actor } = await caller(c)
  const [count, next] = await Promise.all([
    countUnreadPosts(c.var.database, actor.userId),
    nextUnreadPostChangeAt(c.var.database, actor.userId)
  ])
  return c.json({ count, nextChangeAt: next === null ? null : new Date(next).toISOString() }, 200)
})

postsRouter.openapi(routes.getPost, async (c) => {
  const { context } = await caller(c)
  const { postId } = c.req.valid("param")
  const [post, editable] = await Promise.all([
    getPublishedPost(postId, context.database, context.authorize),
    getEditablePost(postId, context.database, context.authorize)
  ])
  if (!post) return c.json({ code: "NOT_FOUND" as const }, 404)
  // For a published Post, whoever may change it may also recall it: its author or an Admin.
  const canChange = editable?.state === "published"
  return c.json({ post: published(post), permissions: { update: canChange, unpublish: canChange } }, 200)
})

postsRouter.openapi(routes.getEditablePost, async (c) => {
  const { context } = await caller(c)
  const post = await getEditablePost(c.req.valid("param").postId, context.database, context.authorize)
  if (!post) return c.json({ code: "NOT_FOUND" as const }, 404)
  return c.json({ ...post, savedAt: iso(post.savedAt) }, 200)
})

postsRouter.openapi(routes.createPost, async (c) => {
  const { context } = await caller(c)
  const input = c.req.valid("json")
  const document = postDocument.parse(JSON.stringify(input.body))
  if (!document) return invalidBody(c)
  const result = await createPostCommand(context, { title: input.title, body: document }, input.publish)
  const failure = writeFailure(c, result)
  if (failure || result.status !== "success") return failure ?? c.json({ code: "INTERNAL" as const }, 500)
  if (input.publish) c.var.scheduleDelivery()
  return c.json({ id: result.postId }, 201)
})

postsRouter.openapi(routes.saveDraft, async (c) => {
  const { context } = await caller(c)
  const input = c.req.valid("json")
  const document = postDocument.parse(JSON.stringify(input.body))
  if (!document) return invalidBody(c)
  const { postId } = c.req.valid("param")
  const result = await saveDraftCommand(context, postId, { title: input.title, body: document }, input.publish)
  const failure = writeFailure(c, result)
  if (failure || result.status !== "success") return failure ?? c.json({ code: "INTERNAL" as const }, 500)
  if (input.publish) c.var.scheduleDelivery()
  return c.json({ id: result.postId }, 200)
})

postsRouter.openapi(routes.editPublishedPost, async (c) => {
  const { context } = await caller(c)
  const input = c.req.valid("json")
  const document = postDocument.parse(JSON.stringify(input.body))
  if (!document) return invalidBody(c)
  const result = await editPublishedPostCommand(context, c.req.valid("param").postId, {
    title: input.title,
    body: document
  })
  const failure = writeFailure(c, result)
  if (failure || result.status !== "success") return failure ?? c.json({ code: "INTERNAL" as const }, 500)
  c.var.scheduleDelivery()
  return c.json({ id: result.postId }, 200)
})

postsRouter.openapi(routes.recallPost, async (c) => {
  const { context } = await caller(c)
  const result = await unpublishPostCommand(context, c.req.valid("param").postId)
  const failure = writeFailure(c, result)
  if (failure || result.status !== "success") return failure ?? c.json({ code: "INTERNAL" as const }, 500)
  c.var.scheduleDelivery()
  return c.json({ id: result.postId, unpublishedTo: result.unpublishedTo }, 200)
})

postsRouter.openapi(routes.discardDraft, async (c) => {
  const { context } = await caller(c)
  const result = await discardDraftCommand(context, c.req.valid("param").postId)
  const failure = writeFailure(c, result)
  if (failure) return failure
  return c.body(null, 204)
})

postsRouter.openapi(routes.markPostRead, async (c) => {
  const { actor } = await caller(c)
  const changed = await markPostRead(c.var.database, actor.userId, c.req.valid("param").postId)
  if (changed) c.var.scheduleDelivery()
  return c.json({ changed }, 200)
})

import { eq } from "drizzle-orm"
import { AUTHORIZATION_DENIED, type AuthorizationDatabase } from "@/core/authz/authorization"
import type { PermissionRequest } from "@/core/authz/model"
import { post } from "@/core/db/schema/posts"
import { logger } from "@/core/logging"
import { getErrorCode, getErrorName, getErrorStatus } from "@/shared/errors"
import * as lifecycle from "../lifecycle"
import { type Authorize, isPostId, type PostsDatabase } from "../service"
import type { UnpublishedTo } from "./unpublished-notice"

/** Where a command writes and how it resolves the acting User inside its transaction. */
export type PostCommandContext = { database: PostsDatabase; authorize: Authorize }

export type PostWriteResult<Success extends object = object> =
  | ({ status: "success"; postId: string } & Success)
  | { status: "unauthorized" }
  | { status: "failed" }
  | { status: "unavailable" }

function logFailure(event: string, error: unknown) {
  logger.error(event, {
    errorCode: getErrorCode(error),
    errorName: getErrorName(error),
    status: getErrorStatus(error)
  })
}

async function writePost<Saved extends { id: string }>(
  { database, authorize }: PostCommandContext,
  event: "save" | "unpublish" | "discard",
  action: "post.create" | "post.update" | "post.publish" | "post.unpublish" | "post.discard",
  postId: string | null,
  write: (actorId: string, tx: AuthorizationDatabase) => Promise<Saved | null>
): Promise<PostWriteResult<Omit<Saved, "id">>> {
  try {
    return await database.transaction(async (tx) => {
      let request: PermissionRequest
      if (action === "post.create") {
        request = { action }
      } else {
        if (!postId || !isPostId(postId)) return { status: "unavailable" as const }
        const [resource] = await tx.select().from(post).where(eq(post.id, postId)).for("update")
        request = { action, context: { post: resource ?? null } }
      }
      const actor = await authorize(request, tx)
      const saved = await write(actor.userId, tx)
      if (!saved) return { status: "unavailable" as const }
      const { id, ...rest } = saved
      return { status: "success" as const, postId: id, ...rest }
    })
  } catch (error) {
    if (getErrorCode(error) === AUTHORIZATION_DENIED) return { status: "unauthorized" }
    logFailure(`news.post.${event}-failed`, error)
    return { status: "failed" }
  }
}

/** Authorize creation for the acting User; content must already satisfy the Post schema. */
export async function createPostCommand(
  context: PostCommandContext,
  content: lifecycle.PostContent,
  publish: boolean
): Promise<PostWriteResult> {
  return writePost(context, "save", "post.create", null, (authorId, tx) =>
    lifecycle.createPost({ authorId, content, publish }, tx)
  )
}

/** Authorize saving or publishing the acting User's own draft; content must be validated. */
export async function saveDraftCommand(
  context: PostCommandContext,
  postId: string,
  content: lifecycle.PostContent,
  publish: boolean
): Promise<PostWriteResult> {
  return writePost(context, "save", publish ? "post.publish" : "post.update", postId, (authorId, tx) =>
    lifecycle.saveDraft({ postId, authorId, content, publish }, tx)
  )
}

/** Authorize an edit to a published Post; content must already satisfy the Post schema. */
export async function editPublishedPostCommand(
  context: PostCommandContext,
  postId: string,
  content: lifecycle.PostContent
): Promise<PostWriteResult> {
  return writePost(context, "save", "post.update", postId, (_actorId, tx) =>
    lifecycle.editPublishedPost({ postId, content }, tx)
  )
}

/** Authorize recalling a published Post and report whose drafts received it. */
export async function unpublishPostCommand(
  context: PostCommandContext,
  postId: string
): Promise<PostWriteResult<{ unpublishedTo: UnpublishedTo }>> {
  return writePost(context, "unpublish", "post.unpublish", postId, async (actorId, tx) => {
    const recalled = await lifecycle.unpublishPost(postId, tx)
    if (!recalled) return null
    const unpublishedTo: UnpublishedTo = recalled.authorId === actorId ? "own" : "author"
    return { id: postId, unpublishedTo }
  })
}

/** Authorize discarding the acting User's own draft. */
export async function discardDraftCommand(context: PostCommandContext, postId: string): Promise<PostWriteResult> {
  return writePost(context, "discard", "post.discard", postId, async (authorId, tx) =>
    (await lifecycle.discardDraft({ postId, authorId }, tx)) ? { id: postId } : null
  )
}

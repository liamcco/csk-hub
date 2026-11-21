import { createPost, discardDraft, editPublishedPost, recallPost, saveDraft } from "@csk-hub/contract/client"
import { newsPostEditPath, newsPostPath } from "@csk-hub/shared/core/navigation/navigation-utils"
import { ROUTES } from "@csk-hub/shared/core/navigation/site"
import { postFormSchema } from "@csk-hub/shared/features/posts/compose/schemas"
import { browserApiClient } from "@/core/api-client/browser"
import { UNPUBLISHED_NOTICE_PARAM } from "./unpublished-notice"

/**
 * What the author typed, kept so a rejected submission does not lose the post.
 * `body` is the editor's document as JSON, exactly as the hidden field carried it.
 */
export type PostFormValues = { title: string; body: string }

export type PostFormError = "formInvalid" | "writeUnauthorized" | "saveFailed" | "postUnavailable"

export type PostFormState = { status: "idle" } | { status: "error"; error: PostFormError; values: PostFormValues }

/** Which Post a form writes: a new one, the author's Draft, or a published Post. */
export type PostFormTarget = { kind: "new" } | { kind: "draft" | "published"; postId: string }

/** A change of state confirmed in a dialog — unpublishing, discarding — rather than a form. */
export type PostCommand = "unpublish" | "discard"

export type PostCommandError = "writeUnauthorized" | "unpublishFailed" | "discardFailed" | "postUnavailable"

type Outcome<Error extends string> = { destination: string } | { error: Error }

function failure<Error extends string>(
  status: number | undefined,
  failed: Error
): Error | "writeUnauthorized" | "postUnavailable" {
  if (status === 401 || status === 403) return "writeUnauthorized"
  if (status === 404) return "postUnavailable"
  return failed
}

/**
 * Validates the form, writes it through the API and names where the author goes next: the
 * published Post, or the Draft's edit page.
 */
export async function submitPost(
  target: PostFormTarget,
  values: PostFormValues,
  publish: boolean
): Promise<Outcome<PostFormError>> {
  const input = postFormSchema.safeParse(values)
  if (!input.success) return { error: "formInvalid" }
  const content = { title: input.data.title, body: input.data.body as { [key: string]: unknown } }
  const client = browserApiClient
  try {
    const { data, response } =
      target.kind === "new"
        ? await createPost({ client, body: { ...content, publish } })
        : target.kind === "draft"
          ? await saveDraft({ client, path: { postId: target.postId }, body: { ...content, publish } })
          : await editPublishedPost({ client, path: { postId: target.postId }, body: content })
    if (!data) return { error: response?.status === 400 ? "formInvalid" : failure(response?.status, "saveFailed") }
    return { destination: publish || target.kind === "published" ? newsPostPath(data.id) : newsPostEditPath(data.id) }
  } catch {
    return { error: "saveFailed" }
  }
}

/** Runs a confirmed command and names where the User lands: the feed, with a recall notice. */
export async function runPostCommand(command: PostCommand, postId: string): Promise<Outcome<PostCommandError>> {
  const client = browserApiClient
  const failed = command === "unpublish" ? "unpublishFailed" : "discardFailed"
  try {
    if (command === "unpublish") {
      const { data, response } = await recallPost({ client, path: { postId } })
      if (!data) return { error: failure(response?.status, failed) }
      return { destination: `${ROUTES.news}?${UNPUBLISHED_NOTICE_PARAM}=${data.unpublishedTo}` }
    }
    const { response } = await discardDraft({ client, path: { postId } })
    if (!response?.ok) return { error: failure(response?.status, failed) }
    return { destination: ROUTES.news }
  } catch {
    return { error: failed }
  }
}

import {
  addGroupMembers,
  leaveGroupConversation,
  renameGroupConversation,
  searchMessageRecipients,
  sendMessage,
  startConversation
} from "@csk-hub/contract/client"
import type { MessagingErrorKind } from "@csk-hub/shared/features/messaging/model/messaging-error"
import { browserApiClient } from "@/core/api-client/browser"
import { type ApiResult, errorCode, errorKind } from "@/core/api-client/result"
import type { MessageCommandState } from "./composer/message-command-state"

const client = browserApiClient

/** Maps the API's `BLANK_MESSAGE` back to the `blank-message` the screens translate. */
function messageCommandError(
  result: ApiResult<unknown>,
  text: string
): Extract<MessageCommandState, { status: "error" }> {
  if (result.response?.status === 401) return { status: "error", error: "sign-in-required", text }
  const code = errorCode(result.error)
  const kind = errorKind(result.error) as MessagingErrorKind | null
  return {
    status: "error",
    error: kind && code !== "VALIDATION_FAILED" && code !== "INTERNAL" ? kind : "unexpected",
    text
  }
}

async function command(
  run: () => Promise<ApiResult<{ conversationId: string }>>,
  text: string
): Promise<MessageCommandState> {
  try {
    const result = await run()
    if (result.data) return { status: "success", conversationId: result.data.conversationId }
    return messageCommandError(result, text)
  } catch {
    return { status: "error", error: "unexpected", text }
  }
}

/**
 * Sends the composer's Message. A failed send keeps its idempotency key, so submitting again
 * retries the same Message rather than sending a second one.
 */
export async function sendMessageCommand(_state: MessageCommandState, formData: FormData) {
  const text = String(formData.get("text") ?? "")
  const conversationId = String(formData.get("conversationId") ?? "")
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "")
  return command(() => sendMessage({ client, path: { conversationId }, body: { text, idempotencyKey } }), text)
}

/** The unique member count selects the Conversation kind on the server as well as in the UI. */
export async function startConversationCommand(_state: MessageCommandState, formData: FormData) {
  const text = String(formData.get("text") ?? "")
  const body = {
    memberIds: formData.getAll("memberIds").map(String),
    text,
    name: String(formData.get("name") ?? ""),
    idempotencyKey: String(formData.get("idempotencyKey") ?? "")
  }
  if (!body.memberIds.length) return { status: "error" as const, error: "recipient-required" as const, text }
  return command(() => startConversation({ client, body }), text)
}

/** Renames, adds members to or leaves a Group Conversation, as the form's `operation` says. */
export async function groupConversationCommand(_state: MessageCommandState, formData: FormData) {
  const name = String(formData.get("name") ?? "")
  const conversationId = String(formData.get("conversationId") ?? "")
  const path = { conversationId }
  switch (formData.get("operation")) {
    case "add":
      return command(
        () => addGroupMembers({ client, path, body: { memberIds: formData.getAll("memberIds").map(String) } }),
        name
      )
    case "rename":
      return command(() => renameGroupConversation({ client, path, body: { name } }), name)
    case "leave":
      return command(() => leaveGroupConversation({ client, path }), name)
    default:
      return { status: "error" as const, error: "conversation-unavailable" as const, text: name }
  }
}

/** Members to message, by name or username. Empty on any failure. */
export async function searchRecipients(query: string) {
  const { data } = await searchMessageRecipients({ client, query: { query } })
  return data?.items ?? []
}

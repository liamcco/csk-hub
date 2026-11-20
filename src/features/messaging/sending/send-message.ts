import "server-only"

import { eq } from "drizzle-orm"
import { conversation } from "@/core/db/schema/messaging"
import { requireActiveGroupMember } from "../group-conversations"
import { type MessagingContext, messagingContext } from "../model/context"
import { validateMessageBody } from "../model/message-body"
import { MessagingAccessError } from "../model/messaging-error"
import { appendMessage } from "./append-message"
import { resolveActiveDirectCounterpart } from "./direct-recipient"

type SendMessageInput = { conversationId: string; text: unknown; idempotencyKey: string }

export async function sendMessage(input: SendMessageInput, context?: MessagingContext) {
  const { database, authorize } = await messagingContext(context)
  const body = validateMessageBody(input.text)

  if (!body.success) throw new MessagingAccessError(body.error)
  if (!input.idempotencyKey.trim()) throw new MessagingAccessError("idempotency-key-required")

  return database.transaction(async (tx) => {
    const { userId } = await authorize({ action: "app.access" }, tx)
    const [target] = await tx
      .select({ kind: conversation.kind })
      .from(conversation)
      .where(eq(conversation.id, input.conversationId))
      .limit(1)
    if (!target) throw new MessagingAccessError("conversation-unavailable")
    if (target.kind === "group")
      return appendMessage(
        tx,
        {
          conversationId: input.conversationId,
          authorUserId: userId,
          text: body.data,
          idempotencyKey: input.idempotencyKey
        },
        () => requireActiveGroupMember(tx, input.conversationId, userId)
      )
    await resolveActiveDirectCounterpart(tx, input.conversationId, userId)
    return appendMessage(tx, {
      conversationId: input.conversationId,
      authorUserId: userId,
      text: body.data,
      idempotencyKey: input.idempotencyKey
    })
  })
}

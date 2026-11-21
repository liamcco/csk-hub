import type { MessagingErrorKind } from "@csk-hub/shared/features/messaging/model/messaging-error"

export type MessageCommandState =
  | { status: "idle" }
  | { status: "error"; error: MessagingErrorKind | "unexpected"; text: string }
  | { status: "success"; conversationId: string }

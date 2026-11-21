import type { Formatter } from "@/core/i18n/translations"

export type MessageDateTimeFormatter = Pick<Formatter, "dateTime">

export function formatMessageSentAt(format: MessageDateTimeFormatter, sentAt: Date) {
  return format.dateTime(sentAt, { dateStyle: "medium", timeStyle: "short" })
}

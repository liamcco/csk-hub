import { z } from "zod"

export const activityChangeSchema = z.object({
  kind: z.enum(["message.created", "conversation.changed", "unread.changed", "posts.changed", "notification.created"]),
  conversationId: z.uuid().optional(),
  sequence: z.number().int().positive().optional()
})

export type ActivityChange = z.infer<typeof activityChangeSchema>

export const activityEventSchema = activityChangeSchema.extend({
  id: z.uuid(),
  notify: z.boolean(),
  notifyUntil: z.number().finite().optional(),
  href: z.string().optional(),
  body: z.string().optional()
})

export const activityReadySchema = z.object({ reset: z.boolean() })

export type ActivityEvent = z.infer<typeof activityEventSchema>

/**
 * Every server-sent event `GET /api/realtime/events` writes. Between frames the stream also sends
 * `: heartbeat` comments carrying the current `id`, at most every 15 seconds.
 */
export const activityStreamFrameSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("ready"), retry: z.literal(3_000), id: z.string(), data: activityReadySchema }),
  z.object({ event: z.literal("activity"), id: z.string(), data: activityEventSchema }),
  z.object({ event: z.literal("unauthorized"), data: z.object({}) }),
  z.object({ event: z.literal("unavailable"), retry: z.literal(5_000), data: z.object({}) })
])

export type ActivityStreamFrame = z.infer<typeof activityStreamFrameSchema>

/** Redis cursors are opaque to callers; accept only bounded stream IDs from browsers. */
export function isStreamCursor(value: string | null): value is string {
  return value !== null && /^\d{1,20}-\d{1,20}$/.test(value)
}

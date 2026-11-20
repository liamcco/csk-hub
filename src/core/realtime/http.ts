import { createRoute, z } from "@hono/zod-openapi"
import type { Context } from "hono"
import { env } from "@/core/config/env"
import { type ApiEnv, createRouter, ValidationErrorSchema } from "@/core/http"
import { type ActivitySession, isActivitySessionActive } from "./access"
import { acknowledgeActivity } from "./acknowledge"
import type { ActivityDeliveryPolicy } from "./delivery-access"
import { activityStreamFrameSchema } from "./events"
import { streamActivity } from "./stream"

const ActivityStreamFrameSchema = activityStreamFrameSchema.meta({
  id: "ActivityStreamFrame",
  description:
    "One server-sent event: `event`, `id` and `retry` are SSE fields and `data` is JSON. `ready` " +
    "opens every stream; `reset: true` asks the client to refresh authoritative state. `activity` " +
    "carries an `ActivityEvent`. `unauthorized` ends the stream when the session stops being valid; " +
    "`unavailable` (with `retry: 5000`) when the broker is unreachable. Heartbeat comments " +
    "(`: heartbeat`) carry the current `id` at most every 15 seconds; the server closes the " +
    "stream after four minutes and EventSource reconnects with `Last-Event-ID`."
})

const streamActivityRoute = createRoute({
  method: "get",
  path: "/events",
  operationId: "streamActivity",
  summary: "The signed-in User's live activity as server-sent events.",
  description:
    "For the User's own, non-impersonated session. Use EventSource; there is no generated client " +
    "call. The stream never fails with an HTTP error a browser could treat as final: without " +
    "real-time delivery or a valid session it answers 204, which stops EventSource.",
  tags: ["realtime"],
  request: {
    headers: z.object({
      "last-event-id": z
        .string()
        .optional()
        .openapi({ description: "The last received `id`; retained events after it are replayed." })
    })
  },
  responses: {
    200: {
      description: "An event stream. Each frame is an `ActivityStreamFrame`.",
      content: { "text/event-stream": { schema: ActivityStreamFrameSchema } }
    },
    204: { description: "Real-time delivery is off, or there is no own, valid session." },
    403: { description: "The request came from another origin." }
  }
})

const acknowledgeActivityRoute = createRoute({
  method: "post",
  path: "/ack",
  operationId: "acknowledgeActivity",
  summary: "Records that a visible client presented a notification, so its Web Push fallback is not sent.",
  description: "Does not mark a Conversation read. Impersonated sessions cannot acknowledge.",
  tags: ["realtime"],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ id: z.uuid() }).openapi("ActivityAcknowledgement") } }
    }
  },
  responses: {
    204: { description: "Acknowledged, or already acknowledged." },
    400: { description: "Invalid input.", content: { "application/json": { schema: ValidationErrorSchema } } },
    401: { description: "No own, valid session." },
    403: { description: "The request did not come from Hub's origin." },
    404: { description: "No such delivery for this User, or it is no longer deliverable." }
  }
})

/**
 * The User behind this request when their own session may receive activity: the session is read
 * afresh, the User reloaded and the stored session rechecked. Impersonation never qualifies.
 */
async function resolveActivitySession(c: Context<ApiEnv>): Promise<ActivitySession | null> {
  const { authorization, impersonatedBy, sessionId } = await c.var.resolveRequest()
  if (!authorization.actor || impersonatedBy || !sessionId) return null
  const identity = { userId: authorization.actor.userId, sessionId }
  return (await isActivitySessionActive(c.var.database, identity)) ? identity : null
}

/**
 * Real-time delivery over HTTP, bound to a feature delivery policy: the event stream and
 * acknowledgements. Mount it at `/api/realtime` behind the Hub Origin guard; the proxy in front
 * must neither buffer nor compress it. Streams end when `shutdown` aborts.
 */
export function createRealtimeRouter(policy: ActivityDeliveryPolicy, shutdown?: AbortSignal) {
  return createRouter()
    .openapi(streamActivityRoute, async (c) => {
      if (!env.REDIS_URL) return c.body(null, 204)
      const identity = await resolveActivitySession(c)
      if (!identity) return c.body(null, 204)
      return streamActivity(policy, {
        database: c.var.database,
        identity,
        lastEventId: c.req.header("last-event-id"),
        signal: shutdown ? AbortSignal.any([c.req.raw.signal, shutdown]) : c.req.raw.signal
      })
    })
    .openapi(acknowledgeActivityRoute, async (c) => {
      const identity = await resolveActivitySession(c)
      if (!identity) return c.body(null, 401)
      const acknowledged = await acknowledgeActivity(policy, c.var.database, identity, c.req.valid("json").id)
      return c.body(null, acknowledged ? 204 : 404)
    })
}

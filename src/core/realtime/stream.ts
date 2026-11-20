import "server-only"

import { and, eq } from "drizzle-orm"
import type { Database } from "@/core/db"
import { activityDelivery } from "@/core/db/schema/activity"
import { activityStreamKey, connectActivityBroker } from "@/core/realtime/broker"
import type { ActivityEvent, ActivityStreamFrame } from "@/core/realtime/events"
import { type ActivitySession, isActivitySessionActive } from "./access"
import { type ActivityDeliveryPolicy, isDeliveryAllowed } from "./delivery-access"
import { PUSH_GRACE_MS } from "./outbox"
import { resolveActivityCursor } from "./stream-cursor"

const STREAM_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "private, no-store, no-transform",
  "X-Accel-Buffering": "no",
  "X-Content-Type-Options": "nosniff"
}

/** Serializes one documented frame; the schema in `events.ts` is the contract for each field. */
function formatFrame(frame: ActivityStreamFrame) {
  const lines = "retry" in frame ? [`retry: ${frame.retry}`] : []
  if ("id" in frame) lines.push(`id: ${frame.id}`)
  lines.push(`event: ${frame.event}`, `data: ${JSON.stringify(frame.data)}`)
  return `${lines.join("\n")}\n\n`
}

function unavailableStream() {
  // A non-200 response can permanently close EventSource. A valid stream followed
  // by EOF preserves its cursor and asks the browser to reconnect after five seconds.
  return new Response(formatFrame({ event: "unavailable", retry: 5_000, data: {} }), { headers: STREAM_HEADERS })
}

/**
 * Streams only the authenticated User's activity; channel selection never comes from the browser.
 * The caller resolves `identity` from the request's own session. The stream ends when `signal`
 * aborts (the client left or the host is shutting down) and rotates after four minutes.
 */
export async function streamActivity(
  policy: ActivityDeliveryPolicy,
  {
    database,
    identity,
    lastEventId,
    signal
  }: { database: Database; identity: ActivitySession; lastEventId: string | undefined; signal: AbortSignal }
) {
  let broker: Awaited<ReturnType<typeof connectActivityBroker>>
  try {
    broker = await connectActivityBroker()
  } catch {
    return unavailableStream()
  }
  const key = activityStreamKey(identity.userId)
  let cursor: string
  let reset: boolean
  try {
    const commands = broker.withCommandOptions({ timeout: 2_000 })
    const [head, tail] = await Promise.all([
      commands.xRange(key, "-", "+", { COUNT: 1 }),
      commands.xRevRange(key, "+", "-", { COUNT: 1 })
    ])
    const resolved = resolveActivityCursor(lastEventId ?? null, head?.[0]?.id ?? "0-0", tail?.[0]?.id ?? "0-0")
    cursor = resolved.cursor
    reset = resolved.reset
  } catch {
    broker.destroy()
    return unavailableStream()
  }
  const encoder = new TextEncoder()
  let stopped = false
  let stopTimer: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    stopped = true
    clearTimeout(stopTimer)
    if (broker.isOpen) broker.destroy()
  }
  const stream = new ReadableStream<Uint8Array>(
    {
      async start(controller) {
        const write = (text: string) => {
          if (!stopped) controller.enqueue(encoder.encode(text))
        }
        if (signal.aborted) stop()
        signal.addEventListener("abort", stop, { once: true })
        stopTimer = setTimeout(stop, 240_000)
        try {
          write(formatFrame({ event: "ready", retry: 3_000, id: cursor, data: { reset } }))
          while (!stopped) {
            if (!(await isActivitySessionActive(database, identity))) {
              write(formatFrame({ event: "unauthorized", data: {} }))
              break
            }
            const entries = await broker
              .withCommandOptions({ timeout: 20_000 })
              .xRead({ key, id: cursor }, { BLOCK: 15_000, COUNT: 50 })
            if (stopped) break
            if (entries && !(await isActivitySessionActive(database, identity))) break
            for (const entry of entries?.[0]?.messages ?? []) {
              cursor = entry.id
              const id = entry.message.delivery
              if (typeof id !== "string" || !/^[\da-f-]{36}$/.test(id)) continue
              const [delivery] = await database
                .select()
                .from(activityDelivery)
                .where(and(eq(activityDelivery.id, id), eq(activityDelivery.userId, identity.userId)))
              if (!delivery || !(await isDeliveryAllowed(policy, delivery))) continue
              const event: ActivityEvent = {
                ...delivery.change,
                id: delivery.id,
                notify: Boolean(delivery.body && !delivery.acknowledgedAt && !delivery.pushCompletedAt),
                ...(delivery.body
                  ? { notifyUntil: delivery.pushAfter?.getTime() ?? delivery.createdAt.getTime() + PUSH_GRACE_MS }
                  : {}),
                ...(delivery.href ? { href: delivery.href } : {}),
                ...(delivery.change.kind === "notification.created" && delivery.body ? { body: delivery.body } : {})
              }
              write(formatFrame({ event: "activity", id: cursor, data: event }))
              if ((controller.desiredSize ?? 0) < -64_000) {
                stop()
                break
              }
            }
            write(`id: ${cursor}\n: heartbeat\n\n`)
          }
        } catch {
          /* Disconnects and Redis failures reconnect through EventSource. */
        } finally {
          signal.removeEventListener("abort", stop)
          stop()
          try {
            controller.close()
          } catch {
            /* Browser cancelled. */
          }
        }
      },
      cancel: stop
    },
    { highWaterMark: 64_000, size: (chunk) => chunk?.byteLength ?? 0 }
  )
  return new Response(stream, { headers: STREAM_HEADERS })
}

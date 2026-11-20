import "server-only"

import { env } from "@/core/config/env"
import { logger } from "@/core/logging"
import { deliverPendingActivity } from "./deliver-pending"
import type { ActivityDeliveryPolicy } from "./delivery-access"
import { DispatchWakeup } from "./dispatch-wakeup"

const running = new Map<
  ActivityDeliveryPolicy,
  { wakeup: DispatchWakeup; signal: AbortSignal; promise: Promise<void> }
>()

function runDispatch(policy: ActivityDeliveryPolicy): Promise<void> {
  const active = running.get(policy)
  if (active) {
    active.wakeup.wake()
    // Finish the expired wave before a newer request starts its own processing window.
    if (active.signal.aborted) return active.promise.then(() => runDispatch(policy))
    return active.promise
  }
  const wakeup = new DispatchWakeup()
  const signal = AbortSignal.timeout(30_000)
  const promise = deliverPendingActivity(policy, signal, wakeup).finally(() => running.delete(policy))
  running.set(policy, { wakeup, signal, promise })
  return promise
}

/**
 * Keeps post-response work alive in the host. Next.js passes `after()` so a request awaits the
 * shared loop; a long-running process such as the standalone API just lets it run.
 */
export type KeepAlive = (work: () => Promise<void>) => void

function inBackground(work: () => Promise<void>) {
  work().catch(() => logger.error("realtime.dispatch.failed"))
}

/** Call after a relevant write commits. Requests share one bounded loop per policy and wake it for new work. */
export function scheduleActivityDispatch(policy: ActivityDeliveryPolicy, keepAlive: KeepAlive = inBackground) {
  if (!env.REDIS_URL) return
  running.get(policy)?.wakeup.wake()
  keepAlive(() => runDispatch(policy))
}

import { env } from "@/core/config/env"
import { logger } from "@/core/logging"
import { getErrorCode, getErrorName } from "@/shared/errors"
import { deliverPendingActivity } from "./deliver-pending"
import type { ActivityDeliveryPolicy } from "./delivery-access"
import { pendingActivityStats } from "./dispatch"
import { DispatchWakeup } from "./dispatch-wakeup"

/** Pending work older than this is reported as a backlog. */
const BACKLOG_AGE_MS = 120_000

export type ActivityWorker = {
  /** Call after a write that queued activity commits: delivery starts without waiting for a poll. */
  wake: () => void
  /** Stops claiming, finishes the current wave and releases its leases. Resolves when idle. */
  stop: () => Promise<void>
}

/**
 * Delivers the outbox from a long-running process, independently of incoming requests. It drains
 * pending work as soon as it starts, waits for the next publication, push, retry or lease-expiry
 * deadline, and otherwise polls every `idlePollMs` for work committed by other processes. Leases
 * coordinate any number of runners. Every `reportEveryMs` it logs the pending count and the age of
 * the oldest pending record. Without Redis it does nothing.
 */
export function startActivityWorker(
  policy: ActivityDeliveryPolicy,
  { idlePollMs = 5_000, reportEveryMs = 60_000 }: { idlePollMs?: number; reportEveryMs?: number } = {}
): ActivityWorker {
  if (!env.REDIS_URL) return { wake() {}, stop: async () => {} }
  const stopping = new AbortController()
  const wakeup = new DispatchWakeup()
  let reportAt = 0

  async function report() {
    if (Date.now() < reportAt) return
    reportAt = Date.now() + reportEveryMs
    try {
      const { pending, oldestAgeMs } = await pendingActivityStats()
      if (oldestAgeMs >= BACKLOG_AGE_MS) logger.warn("realtime.worker.backlog", { pending, oldestAgeMs })
      else logger.info("realtime.worker.pending", { pending, oldestAgeMs })
    } catch (error) {
      logger.warn("realtime.worker.report-failed", { errorCode: getErrorCode(error), errorName: getErrorName(error) })
    }
  }

  async function run() {
    logger.info("realtime.worker.started", { idlePollMs })
    while (!stopping.signal.aborted) {
      const observed = wakeup.revision
      try {
        await deliverPendingActivity(policy, stopping.signal, wakeup)
      } catch (error) {
        logger.error("realtime.worker.failed", { errorCode: getErrorCode(error), errorName: getErrorName(error) })
      }
      await report()
      await wakeup.wait(idlePollMs, stopping.signal, observed)
    }
    logger.info("realtime.worker.stopped")
  }

  const running = run()
  return {
    wake: () => wakeup.wake(),
    async stop() {
      stopping.abort()
      await running
    }
  }
}

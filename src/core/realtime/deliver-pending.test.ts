import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { ActivityDeliveryPolicy } from "./delivery-access"

if (!process.env.CSK_DISPATCH_TEST) {
  test("pending delivery and the supervised worker", async () => {
    const child = Bun.spawn([process.execPath, "test", "--isolate", import.meta.path], {
      env: { ...process.env, CSK_DISPATCH_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe"
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited
    ])
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`)
  })
} else {
  const env = { REDIS_URL: "redis://localhost:6379" }
  mock.module("@/core/config/env", () => ({ env }))
  const policy: ActivityDeliveryPolicy = { canDeliver: async () => true, isAlreadyOpened: async () => false }
  const dispatch = mock(async (_policy: ActivityDeliveryPolicy, _signal?: AbortSignal) => ({ processed: 1 }))
  const nextDelay = mock(async (): Promise<number | null> => null)
  const prune = mock(async () => {})
  const stats = mock(async () => ({ pending: 0, oldestAgeMs: 0 }))
  mock.module("./dispatch", () => ({
    dispatchActivity: dispatch,
    nextActivityDelay: nextDelay,
    pendingActivityStats: stats,
    pruneActivity: prune
  }))
  const sleep = mock(async (_delay: number, _value?: unknown, _options?: { signal: AbortSignal }) => {})
  mock.module("node:timers/promises", () => ({ setTimeout: sleep }))
  const { deliverPendingActivity } = await import("./deliver-pending")
  const { DispatchWakeup } = await import("./dispatch-wakeup")
  const { startActivityWorker } = await import("./worker")

  /** Makes every wait block until it is aborted, as an idle worker's poll would. */
  function blockWaits() {
    sleep.mockImplementation(
      (_delay, _value, options) =>
        new Promise<void>((resolve) => options?.signal.addEventListener("abort", () => resolve(), { once: true }))
    )
  }

  beforeEach(() => {
    env.REDIS_URL = "redis://localhost:6379"
    dispatch.mockReset().mockResolvedValue({ processed: 1 })
    nextDelay.mockReset().mockResolvedValue(null)
    sleep.mockReset().mockResolvedValue(undefined)
  })

  describe("supervised worker", () => {
    test("drains pending work on start, without being woken", async () => {
      blockWaits()
      const worker = startActivityWorker(policy)
      await Bun.sleep(0)
      await worker.stop()
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(dispatch.mock.calls[0][0]).toBe(policy)
    })

    test("a wake while idle starts delivery again at once", async () => {
      blockWaits()
      const worker = startActivityWorker(policy)
      await Bun.sleep(0)
      worker.wake()
      await Bun.sleep(0)
      await worker.stop()
      expect(dispatch).toHaveBeenCalledTimes(2)
    })

    test("stopping waits for the wave in flight and claims nothing more", async () => {
      blockWaits()
      const release = Promise.withResolvers<void>()
      const started = Promise.withResolvers<void>()
      let finished = false
      dispatch.mockImplementationOnce(async (_policy, signal) => {
        started.resolve()
        await release.promise
        finished = true
        expect(signal?.aborted).toBe(true)
        return { processed: 1 }
      })
      const worker = startActivityWorker(policy)
      await started.promise
      const stopped = worker.stop()
      release.resolve()
      await stopped
      expect(finished).toBe(true)
      expect(dispatch).toHaveBeenCalledTimes(1)
    })

    test("disabled realtime starts no worker", async () => {
      env.REDIS_URL = ""
      const worker = startActivityWorker(policy)
      worker.wake()
      await worker.stop()
      expect(dispatch).not.toHaveBeenCalled()
    })
  })

  describe("pending delivery", () => {
    test("a wake during the pending-work query is not lost when it reports an empty queue", async () => {
      const wakeup = new DispatchWakeup()
      nextDelay.mockImplementationOnce(async () => {
        wakeup.wake()
        return null
      })
      await deliverPendingActivity(policy, AbortSignal.timeout(1000), wakeup)
      expect(dispatch).toHaveBeenCalledTimes(2)
    })

    test("waits for a pending push deadline before attempting delivery again", async () => {
      nextDelay.mockResolvedValueOnce(8_000)
      await deliverPendingActivity(policy)
      expect(dispatch).toHaveBeenCalledTimes(2)
      expect(sleep.mock.calls[0][0]).toBe(8_000)
    })

    test("transient database failure retries with backoff", async () => {
      dispatch.mockRejectedValueOnce(new Error("Database unavailable"))
      await deliverPendingActivity(policy)
      expect(dispatch).toHaveBeenCalledTimes(2)
      expect(sleep.mock.calls[0][0]).toBe(1_000)
    })

    test("an abort stops waiting and leaves pending delivery in the database", async () => {
      const stop = new AbortController()
      nextDelay.mockResolvedValue(90_000)
      sleep.mockImplementationOnce(async (_delay, _value, options) => {
        expect(options?.signal).toBe(stop.signal)
        stop.abort()
        throw new Error("Aborted")
      })
      await deliverPendingActivity(policy, stop.signal)
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(sleep).toHaveBeenCalledTimes(1)
    })

    test("an already aborted run does not claim anything", async () => {
      await deliverPendingActivity(policy, AbortSignal.abort())
      expect(dispatch).not.toHaveBeenCalled()
    })
  })
}

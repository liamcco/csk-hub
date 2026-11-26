import { waitUntil } from "@vercel/functions"
import { getBaseURL } from "@/core/auth/base-url"
import { createAuth } from "@/core/auth/create-auth"
import { env, isProduction } from "@/core/config/env"
import { db } from "@/core/db"
import { createApiDependencies } from "@/core/http"
import { deliverPendingActivity } from "@/core/realtime/deliver-pending"
import { DispatchWakeup } from "@/core/realtime/dispatch-wakeup"
import { conversationActivityPolicy } from "@/features/messaging/activity"
import { createApi } from "./app"

// Vercel-only: this module is bundled into apps/api/dist/vercel.mjs and never imported by the
// Docker stack (server.ts starts its own long-running worker there). Vercel has no shared process
// for a worker, so outbox delivery runs per request inside waitUntil() instead.
let activeDelivery: { wakeup: DispatchWakeup; signal: AbortSignal; promise: Promise<void> } | undefined

function runActivityDelivery(): Promise<void> {
  if (activeDelivery) {
    // Let the current wave finish before starting a fresh window.
    if (activeDelivery.signal.aborted) return activeDelivery.promise.then(runActivityDelivery)
    activeDelivery.wakeup.wake()
    return activeDelivery.promise
  }

  const wakeup = new DispatchWakeup()
  const signal = AbortSignal.timeout(30_000)
  const promise = deliverPendingActivity(conversationActivityPolicy, signal, wakeup).finally(() => {
    activeDelivery = undefined
  })
  activeDelivery = { wakeup, signal, promise }
  return promise
}

function scheduleDelivery() {
  // Every request that commits activity keeps the shared delivery run alive.
  if (env.REDIS_URL) waitUntil(runActivityDelivery())
}

/**
 * Vercel invokes this app's fetch handler per request. Previews use the request host for the
 * API origin check and Better Auth's deployment and branch host allowlist for authentication.
 */
export const api = createApi(
  createApiDependencies({
    auth: createAuth({
      database: db,
      baseURL: getBaseURL(env),
      production: isProduction || env.ENVIRONMENT === "preview"
    }),
    database: db,
    secret: env.BETTER_AUTH_SECRET,
    scheduleDelivery,
    publicOrigin: isProduction ? new URL(env.BETTER_AUTH_URL).origin : undefined
  })
)

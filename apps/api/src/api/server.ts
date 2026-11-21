import { logger } from "@csk-hub/shared/core/logging"
import { getBaseURL } from "@/core/auth/base-url"
import { createAuth } from "@/core/auth/create-auth"
import { env, isProduction } from "@/core/config/env"
import { db } from "@/core/db"
import { createApiDependencies } from "@/core/http"
import { startActivityWorker } from "@/core/realtime/worker"
import { conversationActivityPolicy } from "@/features/messaging/activity"
import { createApi } from "./app"

/**
 * The standalone API process: Hono on Bun, with its own database and Redis connections and no
 * Next.js. In the release image this file is bundled to `/app/api.js` (`bun api.js`).
 *
 * Configuration is the application's (`src/core/config/env.ts`) plus `PORT` (default 3000).
 * `BETTER_AUTH_URL` is the public origin browsers use; Hub's own servers call the API by service
 * name and send that origin.
 */

// Outbox delivery runs here, independently of requests; writes wake it after they commit.
const worker = startActivityWorker(conversationActivityPolicy)
const shutdown = new AbortController()

const api = createApi(
  createApiDependencies({
    auth: createAuth({ database: db, baseURL: getBaseURL(env), production: isProduction }),
    database: db,
    secret: env.BETTER_AUTH_SECRET,
    scheduleDelivery: worker.wake,
    publicOrigin: new URL(env.BETTER_AUTH_URL).origin,
    shutdown: shutdown.signal
  })
)

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: Number(process.env.PORT ?? 3000),
  // Seconds without traffic before Bun closes a connection: above the event stream's 15-second
  // heartbeat, so idle streams stay open.
  idleTimeout: 60,
  fetch: api.fetch
})
logger.info("api.started", { port: server.port })

async function stop(signal: string) {
  logger.info("api.stopping", { signal })
  // Event streams end so browsers reconnect to another runner; the worker finishes its wave and
  // releases its leases; in-flight requests finish; then the database pool closes.
  shutdown.abort()
  await worker.stop()
  await server.stop()
  await db.$client.end().catch(() => {})
  process.exit(0)
}

process.once("SIGTERM", () => void stop("SIGTERM"))
process.once("SIGINT", () => void stop("SIGINT"))

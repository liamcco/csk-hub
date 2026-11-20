import { getBaseURL } from "@/core/auth/base-url"
import { createAuth } from "@/core/auth/create-auth"
import { env, isProduction } from "@/core/config/env"
import { db } from "@/core/db"
import { createApiDependencies } from "@/core/http"
import { logger } from "@/core/logging"
import { scheduleActivityDispatch } from "@/features/messaging/activity"
import { createApi } from "./app"

/**
 * The standalone API process: Hono on Bun, with its own database and Redis connections and no
 * Next.js. In the release image this file is bundled to `/app/api.js` (`bun api.js`).
 *
 * Configuration is the application's (`src/core/config/env.ts`) plus `PORT` (default 3000).
 * `BETTER_AUTH_URL` is the public origin browsers use; Hub's own servers call the API by service
 * name and send that origin.
 */
const api = createApi(
  createApiDependencies({
    auth: createAuth({ database: db, baseURL: getBaseURL(env), production: isProduction }),
    database: db,
    secret: env.BETTER_AUTH_SECRET,
    // A long-running process: post-commit delivery simply continues after the response.
    scheduleDelivery: () => scheduleActivityDispatch(),
    publicOrigin: new URL(env.BETTER_AUTH_URL).origin
  })
)

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: Number(process.env.PORT ?? 3000),
  fetch: api.fetch
})
logger.info("api.started", { port: server.port })

async function shutdown(signal: string) {
  logger.info("api.stopping", { signal })
  // Finish in-flight requests, then release the database pool.
  await server.stop()
  await db.$client.end().catch(() => {})
  process.exit(0)
}

process.once("SIGTERM", () => void shutdown("SIGTERM"))
process.once("SIGINT", () => void shutdown("SIGINT"))

import { getBaseURL } from "@/core/auth/base-url"
import { createAuth } from "@/core/auth/create-auth"
import { env, isProduction } from "@/core/config/env"
import { db } from "@/core/db"
import { createApiDependencies } from "@/core/http"
import { type ActivityWorker, startActivityWorker } from "@/core/realtime/worker"
import { conversationActivityPolicy } from "@/features/messaging/activity"
import { createApi } from "./app"

// One worker per Next.js server process, kept across development reloads of this module.
const host = globalThis as { cskActivityWorker?: ActivityWorker }
host.cskActivityWorker ??= startActivityWorker(conversationActivityPolicy)
const worker = host.cskActivityWorker

/**
 * The API bound to the application database, hosted inside `next dev`. Its Better Auth instance
 * shares the Next.js instance's configuration but none of its Next.js plugins, so the API stays
 * host-independent. Outbox delivery runs in a worker started with the first API request, as the
 * standalone API runs one from startup.
 */
export const api = createApi(
  createApiDependencies({
    auth: createAuth({ database: db, baseURL: getBaseURL(env), production: isProduction }),
    database: db,
    secret: env.BETTER_AUTH_SECRET,
    scheduleDelivery: worker.wake
  })
)

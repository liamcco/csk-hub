import "server-only"

import { getBaseURL } from "@/core/auth/base-url"
import { createAuth } from "@/core/auth/create-auth"
import { env, isProduction } from "@/core/config/env"
import { db } from "@/core/db"
import { createApiDependencies } from "@/core/http"
import { scheduleActivityDispatch } from "@/features/messaging/activity"
import { createApi } from "./app"

/**
 * The API bound to the application database. Its Better Auth instance shares the Next.js
 * instance's configuration but none of its Next.js plugins, so the API stays host-independent.
 */
export const api = createApi(
  createApiDependencies({
    auth: createAuth({ database: db, baseURL: getBaseURL(env), production: isProduction }),
    database: db,
    secret: env.BETTER_AUTH_SECRET,
    scheduleDelivery: scheduleActivityDispatch
  })
)

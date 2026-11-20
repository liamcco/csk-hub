import "server-only"

import { getFreshRequestSession } from "@/core/auth/session.server"
import { db } from "@/core/db"
import { createAuthorization } from "./authorization"

/**
 * Authorization bound to the Next.js request session, for Next.js callers that predate the API.
 * The API resolves authority from its own request instead (`@/core/http`), so nothing it imports
 * may depend on this module.
 */
const authorization = createAuthorization({ database: db, readSession: getFreshRequestSession })

export const { can, requirePermission, forCurrentRequest } = authorization

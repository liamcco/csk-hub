import type { AuthorizationActor, PermissionRequest } from "@/core/authz/model"
import type { Database } from "@/core/db"

/**
 * Where a Messaging operation reads and writes, and how it resolves the acting User. The HTTP
 * API passes the request's own; `authorize` must re-check the actor on the given connection.
 */
export type MessagingContext = Readonly<{
  database: Database
  authorize: (request: PermissionRequest, connection?: Database) => Promise<AuthorizationActor>
}>

/**
 * The given context, or for callers that predate the API (tests, background work) the
 * application database and the Next.js request's session. Loaded lazily, so the API never
 * pulls the Next.js session into its module graph.
 */
export async function messagingContext(context?: MessagingContext): Promise<MessagingContext> {
  if (context) return context
  const [{ db }, { requirePermission }] = await Promise.all([import("@/core/db"), import("@/core/authz")])
  return { database: db, authorize: requirePermission }
}

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

import type { Auth } from "@/core/auth/create-auth"
import { readFreshSession } from "@/core/auth/request-session"
import { type AuthorizationDatabase, createAuthorization } from "@/core/authz/authorization"
import type { ApiDependencies } from "./request-context"

/**
 * Binds the API to a Better Auth instance and database. Each resolution reads the request's
 * session afresh and reloads the User, so revocation, expiry, deactivation and role changes apply
 * to the very next protected operation. No Next.js request APIs are involved.
 */
export function createApiDependencies({
  auth,
  database,
  secret,
  scheduleDelivery = () => {}
}: {
  auth: Auth
  database: AuthorizationDatabase
  secret: string
  scheduleDelivery?: () => void
}) {
  return {
    database,
    secret,
    scheduleDelivery,
    handleAuth: (request) => auth.handler(request),
    authApi: auth.api,
    async resolveRequest(headers) {
      let impersonatedBy: string | null = null
      let sessionId: string | null = null
      const authorization = await createAuthorization({
        database,
        readSession: async () => {
          const session = await readFreshSession(auth, headers)
          impersonatedBy = session?.session.impersonatedBy ?? null
          sessionId = session?.session.id ?? null
          return session
        }
      }).forCurrentRequest()
      if (!authorization.actor) return { authorization, impersonatedBy: null, sessionId: null }
      return { authorization, impersonatedBy, sessionId }
    }
  } satisfies ApiDependencies
}

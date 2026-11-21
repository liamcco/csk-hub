import type { Auth } from "./create-auth"

/**
 * Validates the session named by these request headers against the stored session, bypassing
 * Better Auth's cookie cache and refresh. Read-only, so it is safe while a caller holds a Session
 * lock. Callers must still check User status: Better Auth does not reject an existing session
 * solely because its User is banned.
 */
export function readFreshSession(auth: Pick<Auth, "api">, headers: Headers) {
  return auth.api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } })
}

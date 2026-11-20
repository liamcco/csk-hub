import type { RequestAuthorization } from "@/core/authz/authorization"
import type { Database } from "@/core/db"

/** Trusted facts for one protected operation, resolved from the request's own credentials. */
export type ResolvedRequest = Readonly<{
  /** A fresh actor snapshot: the session is revalidated and the User's status and roles reloaded. */
  authorization: RequestAuthorization
  /** The impersonating Admin's User ID when the session is an impersonation, otherwise null. */
  impersonatedBy: string | null
  /** The validated login session's ID when there is an actor, otherwise null. */
  sessionId: string | null
}>

/**
 * What the API needs from its host. Assembly never calls these, so tests and the contract export
 * can build the app without a database or listener.
 */
export type ApiDependencies = Readonly<{
  /** Better Auth's fetch handler, given the request unchanged. */
  handleAuth: (request: Request) => Promise<Response>
  /** Resolves fresh authority from request headers. Call it once per protected operation. */
  resolveRequest: (headers: Headers) => Promise<ResolvedRequest>
  /** The application database or a disposable test database. Assembly never queries it. */
  database: Database
  /** The server secret features derive purpose-bound keys from. Never sent or logged. */
  secret: string
}>

export type ApiEnv = {
  Variables: {
    /**
     * Resolves this request's fresh authority. Each call re-reads the session and User, so call
     * it once per operation and pass the result down; never cache it across requests.
     */
    resolveRequest: () => Promise<ResolvedRequest>
    /** The database for this operation's feature reads and writes. */
    database: Database
    /** The server secret; derive a purpose-bound key from it rather than using it directly. */
    secret: string
  }
}

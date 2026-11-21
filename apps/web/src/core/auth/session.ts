import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query"
import { authClient } from "./auth-client"

/** The browser's Better Auth session, as `/api/auth/get-session` returns it. */
export type BrowserSession = typeof authClient.$Infer.Session

/**
 * The session the web app loads once at start and reuses across navigations. It only shapes
 * routing and presentation: every protected read and command establishes fresh authority on the
 * server. Sign-in, sign-out, a 401 response and an account-status event reload it
 * (`reloadSession`); nothing else refetches it.
 */
export const sessionQuery = queryOptions({
  queryKey: ["session"],
  queryFn: async (): Promise<BrowserSession | null> => {
    const { data, error } = await authClient.getSession()
    if (error) throw new Error(`Loading the session failed with ${error.status}.`)
    return data ?? null
  },
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: Number.POSITIVE_INFINITY
})

/** The current session, or null when signed out. Undefined only before the app has started. */
export function useSession(): BrowserSession | null | undefined {
  return useQuery(sessionQuery).data
}

/**
 * Reloads the session after sign-in, sign-out, a 401 or an account-status change, and drops every
 * other cached read: they belonged to the previous identity.
 */
export async function reloadSession(queryClient: QueryClient) {
  const session = await queryClient.fetchQuery({ ...sessionQuery, staleTime: 0 })
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== sessionQuery.queryKey[0] })
  return session
}

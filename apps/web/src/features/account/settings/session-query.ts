import { queryOptions } from "@tanstack/react-query"
import { authClient } from "@/core/auth/auth-client"

/**
 * Better Auth's own session, read past its cookie cache, for the profile, two-factor and session
 * details the settings show. `/api/auth` keeps serving it outside `/api/v1`.
 */
export const accountSessionQuery = queryOptions({
  queryKey: ["account", "session"],
  queryFn: async () => {
    const { data } = await authClient.getSession({ query: { disableCookieCache: true } })
    return data ?? null
  }
})

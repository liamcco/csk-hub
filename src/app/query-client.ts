import { QueryCache, QueryClient } from "@tanstack/react-query"
import { ApiRequestError, isUnauthenticated } from "@/core/api-client/result"

/**
 * The browser cache behind instant navigation. A visited page renders its cached data at once and
 * refetches it in the background (stale immediately); real-time events invalidate what they affect,
 * so nothing refetches on focus or on a timer. Cached data outlives typical back-and-forth
 * navigation.
 *
 * `onUnauthenticated` runs when a read on screen answers 401: the session ended or the account
 * changed status. (A page's own loader handles a 401 while navigating.)
 */
export function createQueryClient(onUnauthenticated: () => void) {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (isUnauthenticated(error) && query.getObserversCount() > 0) onUnauthenticated()
      }
    }),
    defaultOptions: {
      queries: {
        staleTime: 0,
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: false,
        // A refused or missing resource will not change on retry; a network blip may.
        retry: (failures, error) =>
          failures < 2 && !(error instanceof ApiRequestError && error.status >= 400 && error.status < 500)
      }
    }
  })
}

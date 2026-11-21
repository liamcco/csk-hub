import { type QueryClient, useQueryClient } from "@tanstack/react-query"
import { Link as RouterLink, useLocation, useRouter } from "@tanstack/react-router"
import { type ComponentProps, useMemo } from "react"
import { reloadSession, sessionQuery } from "@/core/auth/session"

const LINK_ORIGIN = "http://csk-hub.local"

/** An internal path split into the parts the router takes; search values stay plain strings. */
export function splitHref(href: string) {
  const url = new URL(href, LINK_ORIGIN)
  return {
    pathname: url.pathname,
    search: Object.fromEntries(url.searchParams),
    hash: url.hash.replace(/^#/, "") || undefined
  }
}

export type LinkProps = Omit<ComponentProps<"a">, "href"> & {
  /** An internal path, optionally with a query and hash. */
  href: string
  /** Replace the current history entry instead of adding one. */
  replace?: boolean
  /** Set false to keep the destination from loading its code and data on hover, focus or touch. */
  preload?: boolean
}

/**
 * A link to a page of the web app. The destination's code and data load on intent (hover, focus or
 * touch), so a click usually renders it without a loading state.
 */
export function Link({ href, replace, preload = true, ...props }: LinkProps) {
  const { pathname, search, hash } = splitHref(href)
  return (
    <RouterLink
      to={pathname}
      search={search}
      hash={hash}
      replace={replace}
      preload={preload ? "intent" : false}
      activeProps={{}}
      {...props}
    />
  )
}

/**
 * Marks every cached read stale and refetches the ones on screen, after a write or when the User
 * returns. The session is left alone: it reloads only on sign-in, sign-out, a 401 or an
 * account-status event.
 */
export function refreshReads(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== sessionQuery.queryKey[0] })
}

type NavigationOptions = {
  /** Set false to keep the scroll position, e.g. when only the query string changes. */
  scroll?: boolean
}

/**
 * Programmatic navigation for screens: push, replace, back, refreshing the cached reads, and moving
 * on after the session changed.
 */
export function useAppRouter() {
  const router = useRouter()
  const queryClient = useQueryClient()
  return useMemo(
    () => ({
      push: (href: string, options?: NavigationOptions) =>
        router.navigate({ href, resetScroll: options?.scroll ?? true }),
      replace: (href: string, options?: NavigationOptions) =>
        router.navigate({ href, replace: true, resetScroll: options?.scroll ?? true }),
      back: () => router.history.back(),
      refresh: () => refreshReads(queryClient),
      /** After signing in or out: reloads the session, drops the previous identity's reads, then navigates. */
      sessionChanged: async (href: string) => {
        await reloadSession(queryClient)
        await router.navigate({ href, replace: true })
      },
      /** After a 401 or an account-status event: reloads the session and re-checks the current page's access. */
      reauthenticate: async () => {
        await reloadSession(queryClient)
        await router.invalidate()
      }
    }),
    [router, queryClient]
  )
}

/** The current path, without query or hash. */
export function usePathname(): string {
  return useLocation({ select: (location) => location.pathname })
}

/** The current query string's parameters. */
export function useSearchParams(): URLSearchParams {
  return new URLSearchParams(useLocation({ select: (location) => location.searchStr }))
}

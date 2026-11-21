import type { CurrentCapabilities } from "@csk-hub/contract/client"
import { loginPath } from "@csk-hub/shared/core/navigation/navigation-utils"
import { type QueryClient, type UseSuspenseQueryOptions, useQueryErrorResetBoundary } from "@tanstack/react-query"
import {
  createLazyRoute,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  type ErrorComponentProps,
  notFound,
  type ParsedLocation,
  redirect,
  useRouter
} from "@tanstack/react-router"
import { z } from "zod"
import { capabilitiesQuery } from "@/core/api-client/capabilities"
import { isUnauthenticated, isUnavailable } from "@/core/api-client/result"
import { getRouteAccessDecision } from "@/core/auth/route-access"
import { reloadSession, sessionQuery } from "@/core/auth/session"
import { accountSessionQuery } from "@/features/account/settings"
import {
  eventEditorQuery,
  eventFormOptionsQuery,
  eventListFilters,
  eventPageQuery,
  locationsQuery,
  managedEventsQuery,
  upcomingEventsQuery
} from "@/features/events/ui"
import { directoryQuery, directorySearch, memberProfileQuery, profileEditorQuery } from "@/features/members"
import { beforeSequence, conversationQuery, inboxQuery } from "@/features/messaging"
import {
  choirPlacementQuery,
  groupDetailQuery,
  groupsOverviewQuery,
  positionCatalogueQuery
} from "@/features/org-structure/ui"
import { editablePostQuery, latestPostsQuery, newsFeedQuery, ownDraftsQuery, postQuery } from "@/features/posts"
import { usersQuery } from "@/features/user-management"
import { AppLayout, FailedScreen, ForbiddenScreen, NotFoundScreen, PublicLayout } from "./layouts"
import type { Screen } from "./route-hooks"

export type RouterContext = { queryClient: QueryClient }

/** A page the session's role does not open: the router renders the forbidden screen. */
class ForbiddenError extends Error {}

// biome-ignore lint/suspicious/noExplicitAny: each page's query keys have their own tuple type.
type Loadable = Pick<UseSuspenseQueryOptions<unknown, Error, unknown, any>, "queryKey" | "queryFn">

/**
 * Loads a page's data into the cache, or answers from it at once when the page was visited before
 * (the screen then refreshes it in the background). Signed-out callers go to sign-in; refused and
 * missing resources render the not-found screen, as the server-rendered pages did.
 */
async function load(context: RouterContext, location: ParsedLocation, ...queries: Loadable[]) {
  try {
    await Promise.all(queries.map((query) => context.queryClient.ensureQueryData(query)))
  } catch (error) {
    if (isUnauthenticated(error)) {
      await reloadSession(context.queryClient)
      throw redirect({ href: loginPath(location.href) })
    }
    if (isUnavailable(error)) throw notFound()
    throw error
  }
}

/** A page gate on the caller's capabilities. It only hides the page; every API operation checks again. */
async function requireCapability(
  context: RouterContext,
  location: ParsedLocation,
  permission: keyof CurrentCapabilities["permissions"]
) {
  await load(context, location, capabilitiesQuery)
  if (!context.queryClient.getQueryData(capabilitiesQuery.queryKey)?.permissions[permission]) throw notFound()
}

function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter()
  const queries = useQueryErrorResetBoundary()
  if (error instanceof ForbiddenError) return <ForbiddenScreen />
  if (isUnavailable(error)) return <NotFoundScreen />
  if (isUnauthenticated(error)) {
    // A read failed with 401 after the page rendered: re-establish who is signed in.
    void reloadSession(router.options.context.queryClient).then(() => router.invalidate())
    return null
  }
  return (
    <FailedScreen
      retry={() => {
        queries.reset()
        reset()
        void router.invalidate()
      }}
    />
  )
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  // The session loads once at app start and is reused; only sign-in, sign-out, a 401 or an
  // account-status event reloads it. Route access mirrors what the server-side proxy decided.
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery)
    const decision = await getRouteAccessDecision(location.pathname, session, location.href)
    if (decision.kind === "redirect") throw redirect({ href: decision.location })
    if (decision.kind === "forbidden") throw new ForbiddenError()
  },
  notFoundComponent: NotFoundScreen,
  errorComponent: RouteError
})

const appLayout = createRoute({ getParentRoute: () => rootRoute, id: "app", component: AppLayout })
const publicLayout = createRoute({ getParentRoute: () => rootRoute, id: "public", component: PublicLayout })

type Page = {
  path: string
  /** The page's screen, in a code chunk of its own area that loads with the page or on intent. */
  screen: () => Promise<Screen>
  loader?: (args: {
    context: RouterContext
    location: ParsedLocation
    params: Record<string, string>
    search: Record<string, unknown>
  }) => Promise<unknown>
}

const uuid = z.uuid()

/** Rejects a malformed ID in the address before asking the API, as the server-rendered pages did. */
function requireUuid(value: string) {
  if (!uuid.safeParse(value).success) throw notFound()
}

function page(parent: typeof appLayout | typeof publicLayout, { path, screen, loader }: Page) {
  return createRoute({
    getParentRoute: () => parent,
    path,
    loaderDeps: ({ search }) => ({ search: search as Record<string, unknown> }),
    loader: loader
      ? ({ context, location, params, deps }) =>
          loader({ context, location, params: params as Record<string, string>, search: deps.search })
      : undefined
  }).lazy(() =>
    screen().then(({ component, pending }) => createLazyRoute(path)({ component, pendingComponent: pending }))
  )
}

const eventsAdminPages = (prefix: "/events/manage" | "/admin/events", gate: boolean): Page[] => [
  {
    path: prefix,
    screen: () => import("./pages/events").then((m) => m.managedEvents),
    loader: async ({ context, location, search }) => {
      if (gate) await requireCapability(context, location, "administerEvents")
      await load(context, location, managedEventsQuery(eventListFilters(search)))
    }
  },
  {
    path: `${prefix}/new`,
    screen: () => import("./pages/events").then((m) => m.newEvent),
    loader: async ({ context, location }) => {
      if (gate) await requireCapability(context, location, "administerEvents")
      await load(context, location, eventFormOptionsQuery)
      if (!context.queryClient.getQueryData(eventFormOptionsQuery.queryKey)?.canCreate) throw notFound()
    }
  },
  {
    path: `${prefix}/$eventId`,
    screen: () => import("./pages/events").then((m) => m.eventEditor),
    loader: async ({ context, location, params }) => {
      // Authorize before validating the address, so non-Admins get the same answer for any Event.
      if (gate) await requireCapability(context, location, "administerEvents")
      requireUuid(params.eventId)
      await load(context, location, eventEditorQuery(params.eventId))
    }
  }
]

const signedInPages: Page[] = [
  {
    path: "/",
    screen: () => import("./pages/home").then((m) => m.home),
    loader: ({ context, location }) =>
      load(context, location, capabilitiesQuery, upcomingEventsQuery, latestPostsQuery(3))
  },
  {
    path: "/news",
    screen: () => import("./pages/posts").then((m) => m.news),
    loader: async ({ context, location }) => {
      await load(context, location, newsFeedQuery)
      if (context.queryClient.getQueryData(newsFeedQuery.queryKey)?.permissions.create)
        await load(context, location, ownDraftsQuery)
    }
  },
  {
    path: "/news/new",
    screen: () => import("./pages/posts").then((m) => m.newPost),
    loader: ({ context, location }) => load(context, location, capabilitiesQuery)
  },
  {
    path: "/news/$id",
    screen: () => import("./pages/posts").then((m) => m.post),
    loader: ({ context, location, params }) => load(context, location, postQuery(params.id))
  },
  {
    path: "/news/$id/edit",
    screen: () => import("./pages/posts").then((m) => m.editPost),
    loader: ({ context, location, params }) => load(context, location, editablePostQuery(params.id))
  },
  {
    path: "/events",
    screen: () => import("./pages/events").then((m) => m.upcomingEvents),
    loader: ({ context, location }) => load(context, location, upcomingEventsQuery)
  },
  {
    path: "/events/$eventId",
    screen: () => import("./pages/events").then((m) => m.eventPage),
    loader: ({ context, location, params }) => load(context, location, eventPageQuery(params.eventId))
  },
  ...eventsAdminPages("/events/manage", false),
  {
    path: "/messages",
    screen: () => import("./pages/messaging").then((m) => m.inbox),
    loader: ({ context, location }) => load(context, location, inboxQuery)
  },
  {
    path: "/messages/$conversationId",
    screen: () => import("./pages/messaging").then((m) => m.conversation),
    loader: async ({ context, location, params, search }) => {
      requireUuid(params.conversationId)
      await load(context, location, conversationQuery(params.conversationId, beforeSequence(search)))
    }
  },
  {
    path: "/members",
    screen: () => import("./pages/members").then((m) => m.directory),
    loader: ({ context, location, search }) => load(context, location, directoryQuery(directorySearch(search)))
  },
  {
    path: "/members/$memberId",
    screen: () => import("./pages/members").then((m) => m.memberProfile),
    loader: ({ context, location, params }) => load(context, location, memberProfileQuery(params.memberId))
  },
  {
    path: "/me",
    screen: () => import("./pages/members").then((m) => m.ownProfile),
    loader: ({ context, location }) => load(context, location, memberProfileQuery())
  },
  {
    path: "/me/edit",
    screen: () => import("./pages/members").then((m) => m.editProfile),
    loader: ({ context, location }) => load(context, location, profileEditorQuery)
  },
  {
    path: "/me/settings",
    screen: () => import("./pages/home").then((m) => m.settings),
    loader: ({ context, location }) => load(context, location, capabilitiesQuery, accountSessionQuery)
  },
  {
    path: "/admin",
    screen: () => import("./pages/admin").then((m) => m.adminStart),
    loader: ({ context, location }) => requireCapability(context, location, "admin")
  },
  {
    path: "/admin/users",
    screen: () => import("./pages/admin").then((m) => m.users),
    loader: async ({ context, location }) => {
      await requireCapability(context, location, "admin")
      await load(context, location, usersQuery)
    }
  },
  {
    path: "/admin/notifications",
    screen: () => import("./pages/admin").then((m) => m.notifications),
    loader: ({ context, location }) => requireCapability(context, location, "admin")
  },
  {
    path: "/admin/org-structure",
    screen: () => import("./pages/organisation").then((m) => m.choirs),
    loader: async ({ context, location }) => {
      await requireCapability(context, location, "admin")
      await load(context, location, choirPlacementQuery)
    }
  },
  {
    path: "/admin/org-structure/groups",
    screen: () => import("./pages/organisation").then((m) => m.groups),
    loader: async ({ context, location }) => {
      await requireCapability(context, location, "admin")
      await load(context, location, groupsOverviewQuery, positionCatalogueQuery)
    }
  },
  {
    path: "/admin/org-structure/$groupId",
    screen: () => import("./pages/organisation").then((m) => m.groupDetail),
    loader: async ({ context, location, params }) => {
      // Authorize before validating the address, so non-Admins get the same answer for any group.
      await requireCapability(context, location, "admin")
      requireUuid(params.groupId)
      await load(context, location, groupDetailQuery(params.groupId))
    }
  },
  ...eventsAdminPages("/admin/events", true),
  {
    path: "/admin/events/locations",
    screen: () => import("./pages/events").then((m) => m.locations),
    loader: async ({ context, location }) => {
      await requireCapability(context, location, "administerEvents")
      await load(context, location, locationsQuery)
    }
  }
]

const publicPages: Page[] = [
  { path: "/login", screen: () => import("./pages/public").then((m) => ({ component: m.LoginPage })) },
  { path: "/two-factor", screen: () => import("./pages/public").then((m) => ({ component: m.TwoFactorPage })) },
  { path: "/activate", screen: () => import("./pages/public").then((m) => ({ component: m.ActivatePage })) },
  {
    path: "/activation-failed",
    screen: () => import("./pages/public").then((m) => ({ component: m.ActivationFailedPage }))
  },
  {
    path: "/forgot-password",
    screen: () => import("./pages/public").then((m) => ({ component: m.ForgotPasswordPage }))
  },
  { path: "/reset-password", screen: () => import("./pages/public").then((m) => ({ component: m.ResetPasswordPage })) },
  { path: "/privacy", screen: () => import("./pages/public").then((m) => ({ component: m.PrivacyPage })) },
  { path: "/support", screen: () => import("./pages/public").then((m) => ({ component: m.SupportPage })) }
]

const routeTree = rootRoute.addChildren([
  appLayout.addChildren(signedInPages.map((definition) => page(appLayout, definition))),
  publicLayout.addChildren(publicPages.map((definition) => page(publicLayout, definition)))
])

/** Query strings stay plain strings, as the pages and their bookmarks have always used them. */
function parseSearch(search: string): Record<string, unknown> {
  return Object.fromEntries(new URLSearchParams(search))
}

function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(search))
    if (value !== undefined && value !== null) params.set(key, String(value))
  const query = params.toString()
  return query ? `?${query}` : ""
}

/**
 * The web app's router. A link's destination code and data load on intent (hover, focus or touch);
 * cached data decides freshness, so the router keeps no separate preload cache.
 */
export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultPendingMs: 150,
    scrollRestoration: true,
    parseSearch,
    stringifySearch
  })
}

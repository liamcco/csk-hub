import type { CurrentCapabilities } from "@contract/client"
import { type QueryClient, type UseSuspenseQueryOptions, useQueryErrorResetBoundary } from "@tanstack/react-query"
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  type ErrorComponentProps,
  notFound,
  type ParsedLocation,
  redirect,
  useParams,
  useRouter,
  useSearch
} from "@tanstack/react-router"
import type { ReactNode } from "react"
import { z } from "zod"
import { capabilitiesQuery } from "@/core/api-client/capabilities"
import { isUnauthenticated, isUnavailable } from "@/core/api-client/result"
import { getRouteAccessDecision } from "@/core/auth/route-access"
import { reloadSession, sessionQuery } from "@/core/auth/session"
import { loginPath } from "@/core/navigation/navigation-utils"
import { accountSessionQuery } from "@/features/account/settings"
import {
  EventPageScreen,
  EventPageScreenSkeleton,
  EventScreen,
  EventScreenSkeleton,
  EventsScreen,
  EventsScreenSkeleton,
  eventEditorQuery,
  eventFormOptionsQuery,
  eventListFilters,
  eventPageQuery,
  LocationsScreen,
  LocationsScreenSkeleton,
  locationsQuery,
  managedEventsQuery,
  NewEventScreen,
  NewEventScreenSkeleton,
  UpcomingEventsScreen,
  UpcomingEventsScreenSkeleton,
  upcomingEventsQuery
} from "@/features/events/ui"
import { HomeScreen } from "@/features/home"
import {
  directoryQuery,
  directorySearch,
  EditProfileScreen,
  EditProfileSkeleton,
  MemberDirectoryScreen,
  MemberDirectorySkeleton,
  MemberProfileScreen,
  MemberProfileSkeleton,
  memberProfileQuery,
  profileEditorQuery
} from "@/features/members"
import {
  beforeSequence,
  ConversationScreen,
  ConversationScreenSkeleton,
  conversationQuery,
  inboxQuery,
  MessagesScreen,
  MessagesScreenSkeleton
} from "@/features/messaging"
import { NotificationManagementScreen } from "@/features/notification-broadcast"
import {
  ChoirsScreen,
  ChoirsScreenSkeleton,
  choirPlacementQuery,
  GroupDetailScreen,
  GroupDetailScreenSkeleton,
  GroupsScreen,
  GroupsScreenSkeleton,
  groupDetailQuery,
  groupsOverviewQuery,
  positionCatalogueQuery
} from "@/features/org-structure/ui"
import {
  EditPostScreen,
  EditPostScreenSkeleton,
  editablePostQuery,
  latestPostsQuery,
  NewPostScreen,
  NewsScreen,
  NewsScreenSkeleton,
  newsFeedQuery,
  ownDraftsQuery,
  PostScreen,
  PostScreenSkeleton,
  postQuery
} from "@/features/posts"
import { UsersScreen, UsersScreenSkeleton, usersQuery } from "@/features/user-management"
import { AppLayout, FailedScreen, ForbiddenScreen, NotFoundScreen, PublicLayout } from "./layouts"
import {
  ActivatePage,
  ActivationFailedPage,
  ForgotPasswordPage,
  LoginPage,
  PrivacyPage,
  ResetPasswordPage,
  SupportPage,
  TwoFactorPage
} from "./pages/public"
import { AdminPage, SettingsPage } from "./pages/signed-in"

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
  component: () => ReactNode
  pending?: () => ReactNode
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

function page(parent: typeof appLayout | typeof publicLayout, { path, component, pending, loader }: Page) {
  return createRoute({
    getParentRoute: () => parent,
    path,
    component,
    pendingComponent: pending,
    loaderDeps: ({ search }) => ({ search: search as Record<string, unknown> }),
    loader: loader
      ? ({ context, location, params, deps }) =>
          loader({ context, location, params: params as Record<string, string>, search: deps.search })
      : undefined
  })
}

function useParam(name: string): string {
  return (useParams({ strict: false }) as Record<string, string>)[name] ?? ""
}

function useSearchLoose(): Record<string, unknown> {
  return useSearch({ strict: false }) as Record<string, unknown>
}

const eventsAdminPages = (prefix: "/events/manage" | "/admin/events", gate: boolean): Page[] => [
  {
    path: prefix,
    component: () => <EventsScreen filters={eventListFilters(useSearchLoose())} />,
    pending: EventsScreenSkeleton,
    loader: async ({ context, location, search }) => {
      if (gate) await requireCapability(context, location, "administerEvents")
      await load(context, location, managedEventsQuery(eventListFilters(search)))
    }
  },
  {
    path: `${prefix}/new`,
    component: NewEventScreen,
    pending: NewEventScreenSkeleton,
    loader: async ({ context, location }) => {
      if (gate) await requireCapability(context, location, "administerEvents")
      await load(context, location, eventFormOptionsQuery)
      if (!context.queryClient.getQueryData(eventFormOptionsQuery.queryKey)?.canCreate) throw notFound()
    }
  },
  {
    path: `${prefix}/$eventId`,
    component: () => <EventScreen eventId={useParam("eventId")} />,
    pending: EventScreenSkeleton,
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
    component: HomeScreen,
    loader: ({ context, location }) =>
      load(context, location, capabilitiesQuery, upcomingEventsQuery, latestPostsQuery(3))
  },
  {
    path: "/news",
    component: NewsScreen,
    pending: NewsScreenSkeleton,
    loader: async ({ context, location }) => {
      await load(context, location, newsFeedQuery)
      if (context.queryClient.getQueryData(newsFeedQuery.queryKey)?.permissions.create)
        await load(context, location, ownDraftsQuery)
    }
  },
  {
    path: "/news/new",
    component: NewPostScreen,
    loader: ({ context, location }) => load(context, location, capabilitiesQuery)
  },
  {
    path: "/news/$id",
    component: () => <PostScreen postId={useParam("id")} />,
    pending: PostScreenSkeleton,
    loader: ({ context, location, params }) => load(context, location, postQuery(params.id))
  },
  {
    path: "/news/$id/edit",
    component: () => <EditPostScreen postId={useParam("id")} />,
    pending: EditPostScreenSkeleton,
    loader: ({ context, location, params }) => load(context, location, editablePostQuery(params.id))
  },
  {
    path: "/events",
    component: () => <UpcomingEventsScreen search={useSearchLoose()} />,
    pending: UpcomingEventsScreenSkeleton,
    loader: ({ context, location }) => load(context, location, upcomingEventsQuery)
  },
  {
    path: "/events/$eventId",
    component: () => <EventPageScreen eventId={useParam("eventId")} />,
    pending: EventPageScreenSkeleton,
    loader: ({ context, location, params }) => load(context, location, eventPageQuery(params.eventId))
  },
  ...eventsAdminPages("/events/manage", false),
  {
    path: "/messages",
    component: MessagesScreen,
    pending: MessagesScreenSkeleton,
    loader: ({ context, location }) => load(context, location, inboxQuery)
  },
  {
    path: "/messages/$conversationId",
    component: () => (
      <ConversationScreen
        conversationId={useParam("conversationId")}
        beforeSequence={beforeSequence(useSearchLoose())}
      />
    ),
    pending: ConversationScreenSkeleton,
    loader: async ({ context, location, params, search }) => {
      requireUuid(params.conversationId)
      await load(context, location, conversationQuery(params.conversationId, beforeSequence(search)))
    }
  },
  {
    path: "/members",
    component: () => <MemberDirectoryScreen search={directorySearch(useSearchLoose())} />,
    pending: MemberDirectorySkeleton,
    loader: ({ context, location, search }) => load(context, location, directoryQuery(directorySearch(search)))
  },
  {
    path: "/members/$memberId",
    component: () => <MemberProfileScreen memberId={useParam("memberId")} />,
    pending: MemberProfileSkeleton,
    loader: ({ context, location, params }) => load(context, location, memberProfileQuery(params.memberId))
  },
  {
    path: "/me",
    component: () => <MemberProfileScreen />,
    pending: MemberProfileSkeleton,
    loader: ({ context, location }) => load(context, location, memberProfileQuery())
  },
  {
    path: "/me/edit",
    component: EditProfileScreen,
    pending: EditProfileSkeleton,
    loader: ({ context, location }) => load(context, location, profileEditorQuery)
  },
  {
    path: "/me/settings",
    component: SettingsPage,
    loader: ({ context, location }) => load(context, location, capabilitiesQuery, accountSessionQuery)
  },
  {
    path: "/admin",
    component: AdminPage,
    loader: ({ context, location }) => requireCapability(context, location, "admin")
  },
  {
    path: "/admin/users",
    component: UsersScreen,
    pending: UsersScreenSkeleton,
    loader: async ({ context, location }) => {
      await requireCapability(context, location, "admin")
      await load(context, location, usersQuery)
    }
  },
  {
    path: "/admin/notifications",
    component: NotificationManagementScreen,
    loader: ({ context, location }) => requireCapability(context, location, "admin")
  },
  {
    path: "/admin/org-structure",
    component: ChoirsScreen,
    pending: ChoirsScreenSkeleton,
    loader: async ({ context, location }) => {
      await requireCapability(context, location, "admin")
      await load(context, location, choirPlacementQuery)
    }
  },
  {
    path: "/admin/org-structure/groups",
    component: GroupsScreen,
    pending: GroupsScreenSkeleton,
    loader: async ({ context, location }) => {
      await requireCapability(context, location, "admin")
      await load(context, location, groupsOverviewQuery, positionCatalogueQuery)
    }
  },
  {
    path: "/admin/org-structure/$groupId",
    component: () => <GroupDetailScreen groupId={useParam("groupId")} />,
    pending: GroupDetailScreenSkeleton,
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
    component: LocationsScreen,
    pending: LocationsScreenSkeleton,
    loader: async ({ context, location }) => {
      await requireCapability(context, location, "administerEvents")
      await load(context, location, locationsQuery)
    }
  }
]

const publicPages: Page[] = [
  { path: "/login", component: LoginPage },
  { path: "/two-factor", component: TwoFactorPage },
  { path: "/activate", component: ActivatePage },
  { path: "/activation-failed", component: ActivationFailedPage },
  { path: "/forgot-password", component: ForgotPasswordPage },
  { path: "/reset-password", component: ResetPasswordPage },
  { path: "/privacy", component: PrivacyPage },
  { path: "/support", component: SupportPage }
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

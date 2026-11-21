import type { NavigationRouteId } from "@csk-hub/shared/core/navigation/site"

/**
 * The unread count each destination shows beside its link, from the features' cached reads. The
 * navigation must not depend on features, so the app layout, which composes them, passes this map
 * in; a destination missing from it, or still loading, shows no badge.
 */
export type UnreadSources = Partial<Record<NavigationRouteId, number | undefined>>

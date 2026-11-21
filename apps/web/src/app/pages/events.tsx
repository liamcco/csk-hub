import {
  EventPageScreen,
  EventPageScreenSkeleton,
  EventScreen,
  EventScreenSkeleton,
  EventsScreen,
  EventsScreenSkeleton,
  eventListFilters,
  LocationsScreen,
  LocationsScreenSkeleton,
  NewEventScreen,
  NewEventScreenSkeleton,
  UpcomingEventsScreen,
  UpcomingEventsScreenSkeleton
} from "@/features/events/ui"
import { type Screen, useParam, useSearchLoose } from "../route-hooks"

export const upcomingEvents: Screen = {
  component: () => <UpcomingEventsScreen search={useSearchLoose()} />,
  pending: UpcomingEventsScreenSkeleton
}
export const eventPage: Screen = {
  component: () => <EventPageScreen eventId={useParam("eventId")} />,
  pending: EventPageScreenSkeleton
}
export const managedEvents: Screen = {
  component: () => <EventsScreen filters={eventListFilters(useSearchLoose())} />,
  pending: EventsScreenSkeleton
}
export const newEvent: Screen = { component: NewEventScreen, pending: NewEventScreenSkeleton }
export const eventEditor: Screen = {
  component: () => <EventScreen eventId={useParam("eventId")} />,
  pending: EventScreenSkeleton
}
export const locations: Screen = { component: LocationsScreen, pending: LocationsScreenSkeleton }

import { ROUTES } from "@csk-hub/shared/core/navigation/site"
import type { EventFormValues } from "@csk-hub/shared/features/events/form-input"
import { DEFAULT_PARTICIPATION_MODE, EVENT_TYPES, type EventType } from "@csk-hub/shared/features/events/model"
import { useSuspenseQuery } from "@tanstack/react-query"
import { useTranslations } from "@/core/i18n/translations"
import { PageBreadcrumb } from "@/core/navigation/PageBreadcrumb"
import { Skeleton } from "@/shared/ui/base/skeleton"
import { eventFormOptionsQuery } from "../queries"
import { EventForm } from "./EventForm"

const FIRST_TYPE = EVENT_TYPES[0] as EventType

/** A new Event's form: a timed Draft of the first type, with nothing filled in. */
export const EMPTY_EVENT_FORM: Omit<EventFormValues, "type" | "participationMode"> = {
  title: "",
  description: null,
  allDay: false,
  startsAt: "",
  endsAt: "",
  firstDay: "",
  lastDay: "",
  callTime: "",
  respondBy: "",
  locationId: "",
  locationText: "",
  organiserGroupId: "",
  leaderUserId: "",
  responsibleUserId: "",
  contactName: "",
  contactDetails: "",
  costInfo: "",
  targets: [],
  details: []
}

/** The form for a new Event, which is saved as a Draft. Its route answers not found to callers who may not create one. */
export function NewEventScreen() {
  const { data: options } = useSuspenseQuery(eventFormOptionsQuery)
  const t = useTranslations("Events")

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-2">
        <PageBreadcrumb route="eventsNew" />
        <h1 className="font-heading text-2xl font-semibold">{t("newPage.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("newPage.description")}</p>
      </div>
      <EventForm
        command={{ kind: "createEvent" }}
        initial={{ ...EMPTY_EVENT_FORM, type: FIRST_TYPE, participationMode: DEFAULT_PARTICIPATION_MODE[FIRST_TYPE] }}
        options={options}
        unsavedSlot="new"
        submitLabel={t("newPage.submit")}
        cancelHref={ROUTES.eventsManage}
      />
    </main>
  )
}

export function NewEventScreenSkeleton() {
  const t = useTranslations("Events")
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8" aria-busy="true">
      <div className="flex flex-col gap-2">
        <PageBreadcrumb route="eventsNew" />
        <h1 className="font-heading text-2xl font-semibold">{t("newPage.title")}</h1>
      </div>
      <FormSkeleton />
    </main>
  )
}

export function FormSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="h-48 w-full rounded-xl" />
      ))}
    </div>
  )
}

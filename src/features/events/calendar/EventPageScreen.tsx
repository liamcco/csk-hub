import { useSuspenseQuery } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { useFormatter, useTranslations } from "@/core/i18n/translations"
import { PageBreadcrumb } from "@/core/navigation/PageBreadcrumb"
import { Link } from "@/core/navigation/router"
import { RichTextContent } from "@/features/rich-text/view"
import { ContentPage } from "@/shared/layouts/content-page"
import { Badge } from "@/shared/ui/base/badge"
import { buttonVariants } from "@/shared/ui/base/button"
import { Skeleton } from "@/shared/ui/base/skeleton"
import { stockholmInstant } from "../model"
import { eventManagementPath } from "../ui/command-state"
import { eventPageQuery } from "../ui/queries"
import { StatusBadge } from "../ui/StatusBadge"
import { eventDays } from "./days"
import { EventKind } from "./EventKind"
import type { EventPage } from "./query"

/**
 * One Event as its Audience reads it. Anything the viewer may not see, including every Draft, is
 * answered as a missing page.
 */
export function EventPageScreen({ eventId }: { eventId: string }) {
  const { data: page } = useSuspenseQuery(eventPageQuery(eventId))
  const t = useTranslations("Events.calendar.page")

  return (
    <ContentPage>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Lets a long title truncate instead of pushing the edit link off the row. */}
        <div className="min-w-0">
          <PageBreadcrumb route="events" current={page.title} />
        </div>
        {page.canManage ? (
          <Link href={eventManagementPath(page.id)} className={buttonVariants({ variant: "outline", size: "sm" })}>
            {t("edit")}
          </Link>
        ) : null}
      </div>
      <article className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="flex flex-wrap items-center gap-2 font-heading text-2xl font-semibold break-words">
            <span className={page.status === "Cancelled" ? "text-muted-foreground line-through" : undefined}>
              {page.title}
            </span>
            {page.status === "Cancelled" ? <StatusBadge status={page.status} /> : null}
          </h1>
          <div>
            <Badge variant="outline">
              <EventKind type={page.type} rehearsalKind={page.rehearsalKind} />
            </Badge>
          </div>
        </header>
        <EventFacts page={page} />
        {page.description ? <RichTextContent document={page.description} /> : null}
      </article>
    </ContentPage>
  )
}

function EventFacts({ page }: { page: EventPage }) {
  const t = useTranslations("Events.calendar.page")
  const format = useFormatter()
  const audience = useAudienceDescription(page.targets)
  const { firstDay, lastDay } = eventDays(page)
  const when = page.allDay
    ? format.dateTimeRange(stockholmInstant(firstDay) as Date, stockholmInstant(lastDay) as Date, {
        dateStyle: "full"
      })
    : format.dateTimeRange(page.startsAt, page.endsAt, { dateStyle: "full", timeStyle: "short" })
  const place = page.locationText ?? page.location?.name

  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
      <Fact label={t("when")}>
        <time dateTime={page.startsAt.toISOString()}>{when}</time>
      </Fact>
      {page.callTime ? (
        <Fact label={t("callTime")}>
          <time dateTime={page.callTime.toISOString()}>{format.dateTime(page.callTime, { timeStyle: "short" })}</time>
        </Fact>
      ) : null}
      {place ? (
        <Fact label={t("where")}>
          <span className="flex flex-col gap-0.5">
            <span>{place}</span>
            {page.location?.address ? <span className="text-muted-foreground">{page.location.address}</span> : null}
            {page.location?.mapUrl ? (
              <a
                href={page.location.mapUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-fit underline underline-offset-4"
              >
                {t("openMap")}
              </a>
            ) : null}
          </span>
        </Fact>
      ) : null}
      {page.organiserGroup ? <Fact label={t("organiser")}>{page.organiserGroup}</Fact> : null}
      <Fact label={t("audience")}>{audience}</Fact>
      {page.leaderName ? <Fact label={t("leader")}>{page.leaderName}</Fact> : null}
      {page.responsibleName ? <Fact label={t("responsible")}>{page.responsibleName}</Fact> : null}
      {page.costInfo ? <Fact label={t("cost")}>{page.costInfo}</Fact> : null}
      {page.details.map(({ label, value }, index) => (
        // Labels may repeat, so their place in the order is the key.
        <Fact key={index} label={label}>
          {value}
        </Fact>
      ))}
    </dl>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="break-words whitespace-pre-line">{children}</dd>
    </div>
  )
}

/** Who the Event is for, in words: "KK", "Basses in KK", "Everyone in CSK". */
function useAudienceDescription(targets: EventPage["targets"]) {
  const t = useTranslations("Events.calendar")
  const format = useFormatter()
  if (targets.length === 0) return t("everyoneInCsk")
  const words = targets.map(({ groupName, voiceFamily }) => {
    if (!voiceFamily) return groupName ?? ""
    const voices = t(`voiceFamilies.${voiceFamily}`)
    return groupName ? t("voiceInGroup", { voices, group: groupName }) : t("voiceInCsk", { voices })
  })
  return format.list(words)
}

export function EventPageScreenSkeleton() {
  return (
    <ContentPage busy>
      <PageBreadcrumb route="events" current={<Skeleton className="h-4 w-32" />} />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-5 w-24" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    </ContentPage>
  )
}

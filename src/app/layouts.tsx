import { useQuery } from "@tanstack/react-query"
import { Outlet } from "@tanstack/react-router"
import { useEffect } from "react"
import { capabilitiesQuery } from "@/core/api-client/capabilities"
import { useLocaleControl } from "@/core/i18n/client"
import { LocaleSwitcher } from "@/core/i18n/locale-switcher"
import { useTranslations } from "@/core/i18n/translations"
import { AppNavigation, AppQuickAccessBar } from "@/core/navigation/app-navigation"
import { Link } from "@/core/navigation/router"
import { ROUTES } from "@/core/navigation/site"
import type { AffectedReads } from "@/core/realtime/ActivityConnection"
import { ActivitySubscription } from "@/core/realtime/ActivitySubscription"
import { ThemeSwitch } from "@/core/theme/ThemeSwitch"
import { eventsKey } from "@/features/events/ui"
import { conversationsKey, useConversationUnreadCount } from "@/features/messaging/unread"
import { postsKey, usePostUnreadCount } from "@/features/posts/unread"
import { CenteredPage } from "@/shared/layouts/centered-page"
import { buttonVariants } from "@/shared/ui/base/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/ui/base/empty"

/** The cached reads each real-time change affects. */
const affectedReads: AffectedReads = (change) => {
  switch (change.kind) {
    case "message.created":
    case "conversation.changed":
      return [conversationsKey]
    case "posts.changed":
      return [postsKey]
    case "unread.changed":
      return [conversationsKey, [...postsKey, "unread"]]
    case "notification.created":
      return []
  }
}

/** Starts a browser without a locale choice in the member's saved locale, once it is known. */
function SavedLocale() {
  const saved = useQuery(capabilitiesQuery).data?.locale
  const { adoptSavedLocale } = useLocaleControl()
  useEffect(() => {
    if (saved !== undefined) void adoptSavedLocale(saved)
  }, [saved, adoptSavedLocale])
  return null
}

/** The signed-in shell: navigation with unread badges, live updates, then the page. */
export function AppLayout() {
  return (
    <>
      <SavedLocale />
      <ActivitySubscription affectedReads={affectedReads} />
      <AppNavigation unreadSources={{ news: usePostUnreadCount(), messages: useConversationUnreadCount() }} />
      <Outlet />
      <AppQuickAccessBar />
    </>
  )
}

/** Sign-in, recovery and information pages. */
export function PublicLayout() {
  return (
    <CenteredPage>
      <div className="flex w-full items-center gap-4 justify-between">
        <ThemeSwitch />
        <LocaleSwitcher />
      </div>
      <Outlet />
    </CenteredPage>
  )
}

function ErrorScreen({ title, description, retry }: { title: string; description: string; retry?: () => void }) {
  const t = useTranslations("Errors")
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-8">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            <h1 className="font-heading text-2xl font-semibold">{title}</h1>
          </EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center">
          {retry ? (
            <button type="button" onClick={retry} className={buttonVariants()}>
              {t("retry")}
            </button>
          ) : null}
          <Link href={ROUTES.home} className={buttonVariants({ variant: retry ? "outline" : "default" })}>
            {t("home")}
          </Link>
        </EmptyContent>
      </Empty>
    </main>
  )
}

/** A missing page, or a resource the User may not see: the two look the same. */
export function NotFoundScreen() {
  const t = useTranslations("Errors")
  return <ErrorScreen title={t("notFoundTitle")} description={t("notFoundDescription")} />
}

/** A page the User's role does not open, such as administration for an ordinary member. */
export function ForbiddenScreen() {
  const t = useTranslations("Errors")
  return <ErrorScreen title={t("forbiddenTitle")} description={t("forbiddenDescription")} />
}

/** An unexpected failure, such as the API being unreachable. */
export function FailedScreen({ retry }: { retry: () => void }) {
  const t = useTranslations("Errors")
  return <ErrorScreen title={t("failedTitle")} description={t("failedDescription")} retry={retry} />
}

import { Bell, CalendarDays, Music, User, Users } from "lucide-react"
import { Suspense } from "react"
import { useTranslations } from "@/core/i18n/translations"
import { PageBreadcrumb } from "@/core/navigation/PageBreadcrumb"
import { Link } from "@/core/navigation/router"
import { ROUTES } from "@/core/navigation/site"
import { AccountSettings, AccountSettingsSkeleton } from "@/features/account/settings"
import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/ui/base/card"

/** The administration start page, linking to each area. Its route opens it to Admins only. */
export function AdminPage() {
  const t = useTranslations("Admin")
  const resources = [
    { href: ROUTES.adminUsers, title: t("members"), description: t("membersDescription"), icon: User },
    { href: ROUTES.adminOrgStructure, title: t("choirs"), description: t("choirsDescription"), icon: Music },
    { href: ROUTES.adminOrgStructureGroups, title: t("groups"), description: t("groupsDescription"), icon: Users },
    { href: ROUTES.adminEvents, title: t("events"), description: t("eventsDescription"), icon: CalendarDays },
    {
      href: ROUTES.adminNotifications,
      title: t("notifications"),
      description: t("notificationsDescription"),
      icon: Bell
    }
  ]

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {resources.map(({ href, title, description, icon: ResourceIcon }) => (
          <Link key={href} href={href} className="group focus-visible:outline-none">
            <Card className="h-full transition-colors group-hover:bg-muted/50 group-focus-visible:ring-2 group-focus-visible:ring-ring">
              <CardHeader className="flex flex-row items-center gap-4">
                <ResourceIcon className="size-12 text-muted-foreground" aria-hidden="true" />
                <div>
                  <CardTitle>{title}</CardTitle>
                  <CardDescription>{description}</CardDescription>
                </div>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  )
}

export function SettingsPage() {
  const t = useTranslations("AccountSettings")
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <PageBreadcrumb route="accountSettings" />
      <div>
        <h1 className="font-heading text-2xl font-semibold">{t("pageTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("pageDescription")}</p>
      </div>
      <Suspense fallback={<AccountSettingsSkeleton />}>
        <AccountSettings />
      </Suspense>
    </main>
  )
}

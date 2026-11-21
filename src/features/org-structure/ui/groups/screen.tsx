import { useSuspenseQuery } from "@tanstack/react-query"
import { useTranslations } from "@/core/i18n/translations"
import { PageBreadcrumb } from "@/core/navigation/PageBreadcrumb"
import { Link } from "@/core/navigation/router"
import { ROUTES } from "@/core/navigation/site"
import { Skeleton } from "@/shared/ui/base/skeleton"
import { PositionCatalogue } from "../catalogue/position-catalogue"
import { groupsOverviewQuery, positionCatalogueQuery } from "../queries"
import { CreateGroupDialog } from "./create-group-dialog"
import { GroupsOverview } from "./overview"

/** The groups beside the Choirs' Sections, and the Positions they can have. */
export function GroupsScreen() {
  const { data: overview } = useSuspenseQuery(groupsOverviewQuery)
  const { data: catalogue } = useSuspenseQuery(positionCatalogueQuery)
  const t = useTranslations("Groups")
  const choirs = overview.choirs
    .filter(({ choir }) => choir.active)
    .map(({ choir }) => ({ id: choir.id, name: choir.name }))

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <PageBreadcrumb route="adminOrgStructureGroups" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">{t("groupsPage.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("groupsPage.description")}</p>
          <Link
            href={ROUTES.adminOrgStructure}
            className="mt-2 inline-block text-sm text-muted-foreground underline underline-offset-4"
          >
            {t("groupsPage.choirsLink")}
          </Link>
        </div>
        <CreateGroupDialog choirs={choirs} />
      </div>

      <GroupsOverview overview={overview} />
      <PositionCatalogue catalogue={catalogue} />
    </main>
  )
}

export function GroupsScreenSkeleton() {
  const t = useTranslations("Groups")
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8" aria-busy="true">
      <PageBreadcrumb route="adminOrgStructureGroups" />
      <div>
        <h1 className="font-heading text-2xl font-semibold">{t("groupsPage.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("groupsPage.description")}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-48 w-full rounded-xl" />
        ))}
      </div>
    </main>
  )
}

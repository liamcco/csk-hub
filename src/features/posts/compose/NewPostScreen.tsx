import { useCapabilities } from "@/core/api-client/capabilities"
import { useTranslations } from "@/core/i18n/translations"
import { PageBreadcrumb } from "@/core/navigation/PageBreadcrumb"
import { ROUTES } from "@/core/navigation/site"
import { ContentPage } from "@/shared/layouts/content-page"
import { Skeleton } from "@/shared/ui/base/skeleton"
import { PostForm } from "./PostForm"

function ComposeHeader() {
  const t = useTranslations("Posts")

  return (
    <div>
      <h1 className="font-heading text-2xl font-semibold">{t("writePost")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("composeDescription")}</p>
    </div>
  )
}

function ComposeForm() {
  // Every active member may write a Post; the API checks again on submit.
  if (!useCapabilities()) return <Skeleton className="h-56 w-full" />
  return (
    <PostForm
      target={{ kind: "new" }}
      stage="draft"
      unsaved={{ slot: "new", version: "new" }}
      cancelHref={ROUTES.news}
    />
  )
}

export function NewPostScreen() {
  return (
    <ContentPage fill>
      <PageBreadcrumb route="newsCompose" />
      <ComposeHeader />
      <ComposeForm />
    </ContentPage>
  )
}

import { useSuspenseQuery } from "@tanstack/react-query"
import { ArrowLeft } from "lucide-react"
import { useTranslations } from "@/core/i18n/translations"
import { Link } from "@/core/navigation/router"
import { ROUTES } from "@/core/navigation/site"
import { Skeleton } from "@/shared/ui/base/skeleton"
import { profileEditorQuery } from "../queries"
import { EditProfileForm } from "./form"

export function EditProfileScreen() {
  const { data: voices } = useSuspenseQuery(profileEditorQuery)
  const t = useTranslations("MemberProfiles")
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <Link
        href={ROUTES.account}
        className="flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("backToProfile")}
      </Link>
      <div>
        <h1 className="font-heading text-2xl font-semibold">{t("editProfile")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("editProfileDescription")}</p>
      </div>
      <EditProfileForm initialVoices={voices} />
    </main>
  )
}

export function EditProfileSkeleton() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6" aria-busy="true">
      <Skeleton className="h-4 w-36" />
      <Skeleton className="h-8 w-52" />
      <Skeleton className="h-64 rounded-4xl" />
      <Skeleton className="h-9 w-32" />
    </main>
  )
}

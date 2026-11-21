import { ROUTES } from "@csk-hub/shared/core/navigation/site"
import { useRouterState } from "@tanstack/react-router"
import { LoaderCircle, Search } from "lucide-react"
import type { FormEvent, ReactNode } from "react"
import { useTranslations } from "@/core/i18n/translations"
import { useAppRouter } from "@/core/navigation/router"
import { Button } from "@/shared/ui/base/button"

/** Searching navigates to the directory with the query in the URL, so a search can be bookmarked. */
export function DirectorySearchForm({ className, children }: { className?: string; children: ReactNode }) {
  const router = useAppRouter()
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const query = String(new FormData(event.currentTarget).get("query") ?? "").trim()
    void router.push(query ? `${ROUTES.members}?${new URLSearchParams({ query })}` : ROUTES.members)
  }
  return (
    <form role="search" onSubmit={submit} className={className}>
      {children}
    </form>
  )
}

export function DirectorySearchButton() {
  const pending = useRouterState({ select: (state) => state.status === "pending" })
  const t = useTranslations("MemberProfiles")
  return (
    <Button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <Search className="size-4" aria-hidden="true" />
      )}
      {t(pending ? "searching" : "search")}
    </Button>
  )
}

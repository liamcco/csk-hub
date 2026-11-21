"use client"

import { useTranslations } from "@/core/i18n/translations"
import { Link } from "@/core/navigation/router"
import { ROUTES } from "@/core/navigation/site"

export function ActivationFailed() {
  const t = useTranslations("Public.activationFailed")

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-2xl tracking-normal">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </header>
      <Link href={ROUTES.forgotPassword} className="text-sm underline underline-offset-4">
        {t("requestFreshLink")}
      </Link>
    </>
  )
}

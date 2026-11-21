import type { Locale } from "@csk-hub/shared/core/i18n/locales"
import { useState } from "react"
import { useTranslations } from "@/core/i18n/translations"
import { updateLocalePreference } from "./locale-preference"

/** Saves the member's locale preference before the shared locale switcher applies it. */
export function useLanguageSettings() {
  const t = useTranslations("AccountSettings")
  const [error, setError] = useState<string>()

  async function persistLocale(locale: Locale) {
    setError(undefined)
    try {
      const result = await updateLocalePreference(locale)
      if (result.success) return true
    } catch {}

    setError(t("languageUpdateFailed"))
    return false
  }

  return { error, persistLocale }
}

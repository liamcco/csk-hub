import { updateLocalePreference as saveLocale } from "@contract/client"
import { browserApiClient } from "@/core/api-client/browser"
import type { Locale } from "@/core/i18n/locales"

/** Saves the signed-in member's locale preference without replacing their other preferences. */
export async function updateLocalePreference(locale: Locale) {
  const { response } = await saveLocale({ client: browserApiClient, body: { locale } })
  return { success: response?.ok === true }
}

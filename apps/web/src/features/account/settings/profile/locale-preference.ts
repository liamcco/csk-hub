import { updateLocalePreference as saveLocale } from "@csk-hub/contract/client"
import type { Locale } from "@csk-hub/shared/core/i18n/locales"
import { browserApiClient } from "@/core/api-client/browser"

/** Saves the signed-in member's locale preference without replacing their other preferences. */
export async function updateLocalePreference(locale: Locale) {
  const { response } = await saveLocale({ client: browserApiClient, body: { locale } })
  return { success: response?.ok === true }
}

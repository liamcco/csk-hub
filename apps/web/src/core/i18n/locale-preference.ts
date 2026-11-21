import { defaultLocale, isLocale, type Locale } from "@csk-hub/shared/core/i18n/locales"

/**
 * Resolves the locale for a request from its browser-specific choice and the member's saved default.
 * A valid cookie is authoritative; the saved locale only initializes browsers without one.
 *
 * @param cookieLocale - The validated locale selected in the current browser, if present.
 * @param savedLocale - The validated locale stored in the member's preferences, or `null` when unset.
 * @returns The browser locale, then the saved locale, or `undefined` when neither exists.
 */
export function resolveLocalePreference(
  cookieLocale: Locale | undefined,
  savedLocale: Locale | null | undefined
): Locale | undefined {
  return cookieLocale ?? savedLocale ?? undefined
}

/**
 * The locale for a browser with neither a locale cookie nor a saved member locale: its first
 * supported language, matched by primary subtag (`de-AT` is `de`), else the default locale.
 */
export function negotiateLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const primary = language.toLowerCase().split("-")[0]
    if (isLocale(primary)) return primary
  }
  return defaultLocale
}

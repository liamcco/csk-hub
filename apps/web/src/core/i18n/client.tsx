import type { Locale } from "@csk-hub/shared/core/i18n/locales"
import { timeZone } from "@csk-hub/shared/core/i18n/time-zone"
import { createContext, type ReactNode, useCallback, useContext, useState } from "react"
import { IntlProvider } from "use-intl"
import { UiLabelsProvider } from "@/shared/ui/UiLabelsProvider"
import { LocalizedFormProvider } from "./LocalizedFormProvider"
import { readBrowserLocaleCookie, writeBrowserLocaleCookie } from "./locale-cookie"
import { negotiateLocale } from "./locale-preference"

export { IntlProvider, useLocale } from "use-intl"

type Messages = typeof import("@csk-hub/shared/messages/en.json")

/** Each catalogue is its own chunk; only the active locale's is downloaded. */
const catalogues: Record<Locale, () => Promise<{ default: Messages }>> = {
  en: () => import("@csk-hub/shared/messages/en.json"),
  sv: () => import("@csk-hub/shared/messages/sv.json"),
  de: () => import("@csk-hub/shared/messages/de.json")
}

/** Loads a locale's message catalogue. */
export async function loadMessages(locale: Locale): Promise<Messages> {
  return (await catalogues[locale]()).default
}

/**
 * The locale a browser starts in before the member's saved locale is known: its own cookie choice,
 * else its languages, else the default.
 */
export function initialBrowserLocale(): Locale {
  return readBrowserLocaleCookie() ?? negotiateLocale(navigator.languages)
}

type LocaleControl = {
  /** Switches the app to a locale and records it as this browser's choice. */
  changeLocale: (locale: Locale) => Promise<void>
  /** Switches to a member's saved locale when this browser has made no choice of its own. */
  adoptSavedLocale: (locale: Locale | null) => Promise<void>
}

const LocaleControlContext = createContext<LocaleControl | null>(null)

/** Locale switching for the locale controls and the app shell. */
export function useLocaleControl(): LocaleControl {
  const control = useContext(LocaleControlContext)
  if (!control) throw new Error("useLocaleControl needs the I18nProvider.")
  return control
}

/** Supplies translations, the locale and locale switching to the whole app. */
export function I18nProvider({
  initial,
  children
}: {
  initial: { locale: Locale; messages: Messages }
  children: ReactNode
}) {
  const [{ locale, messages }, setCurrent] = useState(initial)

  const switchTo = useCallback(async (next: Locale) => {
    const nextMessages = await loadMessages(next)
    document.documentElement.lang = next
    setCurrent({ locale: next, messages: nextMessages })
  }, [])

  const changeLocale = useCallback(
    async (next: Locale) => {
      writeBrowserLocaleCookie(next)
      await switchTo(next)
    },
    [switchTo]
  )

  const adoptSavedLocale = useCallback(
    async (saved: Locale | null) => {
      // A browser's own choice is authoritative; a saved locale only initializes browsers without one.
      if (!saved || readBrowserLocaleCookie()) return
      writeBrowserLocaleCookie(saved)
      if (saved !== locale) await switchTo(saved)
    },
    [locale, switchTo]
  )

  return (
    <IntlProvider locale={locale} messages={messages} timeZone={timeZone}>
      <LocaleControlContext.Provider value={{ changeLocale, adoptSavedLocale }}>
        <UiLabelsProvider labels={messages.Ui}>
          <LocalizedFormProvider>{children}</LocalizedFormProvider>
        </UiLabelsProvider>
      </LocaleControlContext.Provider>
    </IntlProvider>
  )
}

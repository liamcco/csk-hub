import { useOptimistic, useTransition } from "react"
import { useLocale, useTranslations } from "use-intl"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/base/select"
import { useLocaleControl } from "./client"
import { LocaleFlag } from "./locale-flag"
import { defaultLocale, getLocaleName, isLocale, type Locale, localeNames, locales } from "./locales"

export interface LocaleSwitcherProps {
  id?: string
  className?: string
  size?: "sm" | "default"
  /**
   * Runs before the locale cookie is written, e.g. to save the member's preference.
   * Return `false` to keep the current locale.
   */
  persistLocale?: (locale: Locale) => Promise<boolean>
}

/** Renders the locale control and switches the app's locale after an explicit selection. */
export function LocaleSwitcher({ id, className, size = "sm", persistLocale }: LocaleSwitcherProps) {
  const { changeLocale: switchLocale } = useLocaleControl()
  const locale = useLocale()
  const t = useTranslations("Navigation")
  const [isPending, startTransition] = useTransition()
  const [selectedLocale, setOptimisticLocale] = useOptimistic<Locale>(isLocale(locale) ? locale : defaultLocale)

  function changeLocale(nextLocale: string | null) {
    if (!isLocale(nextLocale) || nextLocale === selectedLocale) return

    startTransition(async () => {
      setOptimisticLocale(nextLocale)
      if (persistLocale && !(await persistLocale(nextLocale))) return

      await switchLocale(nextLocale)
    })
  }

  return (
    <Select value={selectedLocale} onValueChange={changeLocale} disabled={isPending}>
      <SelectTrigger id={id} aria-label={t("language")} size={size} className={className}>
        <SelectValue>
          {(value: string | null) => (
            <>
              <LocaleFlag locale={isLocale(value) ? value : defaultLocale} />
              {getLocaleName(value)}
            </>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="p-1.5">
        {locales.map((supportedLocale) => (
          <SelectItem key={supportedLocale} value={supportedLocale} className="">
            <LocaleFlag locale={supportedLocale} />
            {localeNames[supportedLocale]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

import { createTranslator } from "use-intl/core"
import type { Locale } from "./locales"
import { getMessages } from "./messages"
import { timeZone } from "./time-zone"

/**
 * A translator for server-generated text such as email and notifications. The caller chooses the
 * recipient's locale explicitly; the API never infers it from a request.
 */
export function getTranslator(locale: Locale) {
  return createTranslator({ locale, messages: getMessages(locale), timeZone })
}

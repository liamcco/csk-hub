import type { Locale } from "@csk-hub/shared/core/i18n/locales"
import { getMessages } from "@csk-hub/shared/core/i18n/messages"
import { timeZone } from "@csk-hub/shared/core/i18n/time-zone"
import { createTranslator } from "use-intl/core"

/**
 * A translator for server-generated text such as email and notifications. The caller chooses the
 * recipient's locale explicitly; the API never infers it from a request.
 */
export function getTranslator(locale: Locale) {
  return createTranslator({ locale, messages: getMessages(locale), timeZone })
}

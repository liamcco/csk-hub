import type messages from "../../messages/en.json"
import type { Locale } from "./locales"

declare module "use-intl" {
  interface AppConfig {
    Messages: typeof messages
    Locale: Locale
  }
}

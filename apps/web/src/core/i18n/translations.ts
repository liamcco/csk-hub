import type { createFormatter } from "use-intl/core"

export { useFormatter, useTimeZone, useTranslations } from "use-intl"

/** What `useFormatter` returns. */
export type Formatter = ReturnType<typeof createFormatter>

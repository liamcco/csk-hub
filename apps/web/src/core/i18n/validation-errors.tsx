"use client"

import { validationMessageIds } from "@csk-hub/shared/shared/schemas"
import { useTranslations } from "@/core/i18n/translations"
import type { ValidationFormatter } from "@/shared/forms/validation-messages"

const messageIds = Object.values(validationMessageIds)

/** Translates registered validation IDs or issues; preserves other messages as plain text. */
export function useValidationMessage(): ValidationFormatter {
  const common = useTranslations("Common")
  return (issue) => {
    const error = typeof issue === "string" ? { message: issue } : issue
    const key = messageIds.find((id) => id === error?.message)
    if (!key) return error?.message

    return common(key, {
      ...(typeof error?.minimum === "number" ? { count: error.minimum } : {}),
      ...error?.params
    })
  }
}

import { describe, expect, test } from "bun:test"
import { type Locale, locales } from "../core/i18n/locales"
import de from "./de.json"
import en from "./en.json"
import sv from "./sv.json"

const messages = { en, sv, de } satisfies Record<Locale, object>

function messageKeys(messages: object, parentKey = ""): string[] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const messageKey = parentKey ? `${parentKey}.${key}` : key

    if (value && typeof value === "object" && !Array.isArray(value)) {
      return messageKeys(value, messageKey)
    }

    return messageKey
  })
}

describe("translation catalogues", () => {
  const englishKeys = messageKeys(en).sort()

  for (const locale of locales) {
    test(`${locale} has the same message keys as English`, () => {
      expect(messageKeys(messages[locale]).sort()).toEqual(englishKeys)
    })
  }
})

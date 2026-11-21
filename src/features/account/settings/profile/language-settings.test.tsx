import { describe, expect, mock, test } from "bun:test"
import messages from "@messages/en.json"
import { renderToStaticMarkup } from "react-dom/server"
import { I18nProvider } from "@/core/i18n/client"

mock.module("./locale-preference", () => ({
  updateLocalePreference: mock(async () => ({ success: true as const }))
}))

const { LanguageSettings } = await import("./language-settings")

describe("LanguageSettings", () => {
  test("selects the active application locale when no preference is saved", () => {
    const markup = renderToStaticMarkup(
      <I18nProvider initial={{ locale: "en", messages }}>
        <LanguageSettings />
      </I18nProvider>
    )

    expect(markup).toContain('value="en"')
  })
})

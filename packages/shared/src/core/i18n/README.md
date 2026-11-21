# Internationalization

CSK Hub's locale contract: supported locales, the locale cookie, translation catalogues and the
`use-intl` integration. Read this file before adding user-facing copy.

The public URL never contains a locale. The web app chooses the locale in the browser; the API
chooses it explicitly for each recipient of server-generated text.

## Where the pieces live

`core/i18n` exists in three packages, each holding what its side runs:

- `packages/shared/src/core/i18n`: `locales.ts` (the supported locales and the default),
  `locale-validation.ts`, `time-zone.ts`, `messages.ts` (the catalogues by locale) and
  `use-intl.d.ts`, which registers the English catalogue as the canonical message shape.
- `apps/web/src/core/i18n`: the provider and locale switching (`client.tsx`), the hooks
  (`translations.ts`), the locale cookie (`locale-cookie.ts`), locale negotiation
  (`locale-preference.ts`), `LocalizedFormProvider` and validation messages.
- `apps/api/src/core/i18n`: `getTranslator(locale)` (`server.ts`) for email, notifications and
  other server-generated text.

Only these `core/i18n` modules import `use-intl`; architecture tests enforce it in both apps.

## Translation interface

Web components use the hooks from `@/core/i18n/translations`:

```tsx
import { useTranslations } from "@/core/i18n/translations"

export function SaveButton() {
  const t = useTranslations("Example")

  return <button type="submit">{t("save")}</button>
}
```

`I18nProvider` in `main.tsx` supplies the locale, the active catalogue and the Stockholm time zone
to the whole app. Do not add another provider or pass a catalogue through feature props. Tests that
render translated components wrap them in `IntlProvider` (or `I18nProvider` when they need locale
switching) from `@/core/i18n/client`.

Server-generated text calls `getTranslator(locale)` with the intended recipient's locale. The API
never infers a locale from the request. API operations return typed outcomes or stable error
codes; the web app translates them.

Keep shared UI base components independent of this module. Shared controls read built-in labels
from `UiLabelsProvider` (`apps/web/src/shared/ui`), which defaults to English; the provider
supplies `messages.Ui`. Keep the `Ui` namespace aligned with the `UiLabels` type in every
catalogue. These labels are plain text without ICU formatting.

## Catalogues and keys

The catalogues are `packages/shared/src/messages/<locale>.json`. The web app loads only the active
locale's catalogue (one chunk each); the API reads them through `messages.ts`. Import a catalogue
directly only in tests.

Keep the catalogues parallel. When adding a key, add its translation to every locale in the same
change (`messages.test.ts` checks parity). Group keys by a durable feature or screen namespace,
not by source file:

```json
{
  "AccountSettings": {
    "language": {
      "title": "Language"
    }
  }
}
```

Translate every user-facing string, including headings, controls, empty states, dialogs and
validation or error copy. Biome enforces `style/noJsxLiterals` as an error except in
`apps/web/src/shared/ui/base/**`.

Preserve ICU placeholders and plural/select logic across locales, and use ICU parameters instead of
concatenating translated fragments:

```json
"memberCount": "{count, plural, =0 {No members} one {# member} other {# members}}"
```

`locales.ts` is the single source of truth for valid locales and the default. Adding a locale
means updating it and adding a complete catalogue.

## Validation messages

Keep Zod schemas static and locale-neutral. Validation issues carry stable IDs and machine-readable
parameters, not translated text. Pass issues to the shared `InputField` or `SelectField` through
`errors`; `LocalizedFormProvider` (`apps/web/src/core/i18n`) supplies the formatter through shared
forms' validation context. Use `useValidationMessage` to display validation errors elsewhere.

Register new validation IDs in `validationMessageIds` in `packages/shared/src/shared/schemas.ts`
and add matching keys under `Common.validation` in every catalogue.

## Locale resolution and the cookie

`NEXT_LOCALE` is the per-browser locale choice; the name predates the Vite web app and is kept so
existing browsers keep their choice. The web app starts in the first of:

1. a valid `NEXT_LOCALE` cookie,
2. the member's saved locale (from `getCurrentCapabilities`), which then initializes the cookie,
3. the browser's languages,
4. the default, Swedish.

Browser code must not write the cookie directly; use `locale-cookie.ts` (`apps/web/src/core/i18n`).
The Account Settings control saves the member's locale and switches the browser, so both agree.

## Verification

Run `bun run typecheck`, `bun run lint` and `bun --env-file=.env run tst` after i18n changes; the
account journey (`e2e/account.e2e.ts`) checks a saved language end to end.

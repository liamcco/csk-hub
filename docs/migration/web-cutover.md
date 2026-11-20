# Cutting the web app over to Vite

Tracks liamcco/csk-hub#7: the web experience runs as a Vite React SPA (TanStack Router and
TanStack Query over the generated client) against the standalone Hono API, and the Next.js
runtime is gone.

## Decisions

- Translations: `use-intl` replaces next-intl (user decision). `src/core/i18n` is the only module
  importing it; the sv/en/de catalogues, ICU syntax and the English-catalogue type registration
  stay. Server-generated text uses `getTranslator(locale)` (`createTranslator`). Locale resolution
  runs in the browser: the `NEXT_LOCALE` cookie, else the member's saved locale (now part of
  `getCurrentCapabilities`), else the browser's languages, else Swedish.
- Routing: one code-based TanStack route tree in `src/app/router.tsx`. Pages keep their paths
  (no locale prefix). Route access (`core/auth/route-access`) runs in the root `beforeLoad` with
  the session loaded once at start (`core/auth/session`); capability gates and page reads run in
  route loaders through `ensureQueryData`, so revisits render from cache and refresh in the
  background. Links preload code and data on intent.
- Navigation facade: `@/core/navigation/router` (`Link`, `useAppRouter`, `usePathname`,
  `useSearchParams`) replaces `next/link` and `next/navigation`. `router.refresh()` now
  invalidates every cached read except the session.
- Real-time: `ActivityConnection` invalidates the queries an event affects (mapping in
  `src/app/layouts.tsx`); `ready.reset` invalidates all reads; `unauthorized` reloads the session.
- `server-only` is gone: the Vite build refuses server packages (`vite.config.ts`, `webOnly`).
- One package, two builds: `vite build` (web, `dist/web`) and `bun build src/api/server.ts`
  (API). Feature folders keep their UI beside their HTTP routes; web entrypoints are the screens'
  index files (for Events, `@/features/events/ui`).

## Resume here

Done (uncommitted WIP at the first checkpoint, committed as "WIP"):
- Vite config, `index.html`, `src/app/{main,router,layouts,query-client}.tsx`, pages.
- i18n on use-intl; locale switcher; saved locale via capabilities (API test added).
- Every screen converted from server components to `useSuspenseQuery` over per-feature query
  options (`queries.ts` / `query.ts` in each feature UI folder).
- Next.js, next-intl, `server-only`, `@vercel/analytics`, `react-form-nextjs` removed from
  dependencies; `vite build` succeeds.

Half-done (second WIP commit):
- `e2e/run.ts`, `e2e/fixtures.ts`, `playwright.config.ts`: dev mode (API on 3101 + Vite on 3100,
  disposable database) works; `e2e/members.e2e.ts` passes (4/4). Other journeys not yet run.
  `--stack` mode is written but untested and needs `deploy/compose.local.yml` publishing the
  database on 127.0.0.1:${DB_PORT:-5434} (not written yet).
- `package.json` scripts: `dev`, `dev:api`, `dev:web`, `build:web`, `build:api`; `"type": "module"`.

Next:
1. Run the remaining journeys and fix them (`shell.e2e.ts` expects HTTP 403 for `/admin/users`;
   the SPA now renders the forbidden screen instead); add the instant-navigation journeys from
   the acceptance criteria.
2. Fix typecheck, lint, unit tests (tests that mocked `next/navigation` or `authz/request`,
   `core/auth/session.server.ts`, `core/authz/request.ts`, `architecture.test.ts` rules).
3. Route-level code splitting.
4. Deploy: Dockerfile targets for `api` and a static `web` server (Caddy with history fallback
   for web paths only), `compose.yml`, `local-stack.sh`, `validate-stack.ts` (route fallback).
5. Docs: README, `src/core/i18n/README.md`, `deploy/README.md`, codebase-structure, ADR note.

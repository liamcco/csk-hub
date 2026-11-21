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
  `src/app/layouts.tsx`); `ready.reset` invalidates all reads; `unauthorized` reloads the session, as does a 401 from a
  read on screen (`src/app/query-client.ts`) or from a command (`reloadSessionOnUnauthenticatedCommand`).
- `server-only` is gone: the Vite build refuses server packages (`vite.config.ts`, `webOnly`).
- Workspace (user decision 2026-11-21): a Bun workspace with the isolated linker.
  - `apps/api` (`@csk-hub/api`): Hono API, CLI, Drizzle schema and migrations, dev database CLI.
  - `apps/web` (`@csk-hub/web`): the Vite SPA. It reaches API behaviour only through the contract.
  - `packages/shared` (`@csk-hub/shared`): code both run (models, form schemas, rich-text
    document schema, locales, catalogues in `src/messages`). Relative imports only inside it.
  - `packages/contract` (`@csk-hub/contract`): `openapi.json`, the generated client and the
    Hey API generator. The isolated linker gives it TypeScript 6 (Hey API's peer) beside the
    apps' TypeScript 7, which is what broke the earlier attempt with the hoisted linker.
  - Each app's tsconfig maps `@/*` to its own `src`, plus `@csk-hub/shared/*` and
    `@csk-hub/contract/*`; Vite mirrors the aliases. Files keep their old `src/...` path inside
    their package, so a path in an old note maps to `apps/<api|web>/src/...` or
    `packages/shared/src/...`.
  - Web types for API data come from contract types (`QueryData` over the web query options),
    never from API modules. Shared models own enum value lists; the Drizzle schema takes them.
- VAPID env (user decision): the API reads `VAPID_PUBLIC_KEY`; the web reads
  `VITE_VAPID_PUBLIC_KEY` (`.env.example` sets it from `$VAPID_PUBLIC_KEY`). No `NEXT_PUBLIC_`
  fallback. A developer `.env` with the old name must be renamed.

## Local checks

- `bun install`
- `bun lint`, `bun typecheck` (each package plus the root e2e project)
- `bun --env-file=.env run tst` (shared, API, web suites in turn)
- `bun run api:generate` then `git status --porcelain` must be clean
- `bun --env-file=.env run e2e [files]` (API + Vite dev server on a disposable database)
- `bun run build` (web to `apps/web/dist`, API to `apps/api/dist`)

## Resume here

Done:
- Vite SPA, use-intl, TanStack Router/Query port (earlier WIP commits).
- Typecheck, lint and unit tests pass; Next-only session modules and mocks removed.
- Workspace split (above); builds, `api:generate` and the members journeys pass after it.
- Posts publish with the database clock (fixes the known unread flake against a skewed DB).
- All journeys pass in dev mode (19 + 4 navigation journeys in `e2e/navigation.e2e.ts`; the
  real-time one needs `REDIS_URL`, e.g. `redis://localhost:6379` from `deploy/compose.dev.yml`).
  Denied pages are asserted by their screen ("Page not found" / "No access") plus the API's 403.
- Code splitting: each route's screen loads lazily from `apps/web/src/app/pages/<area>.tsx`
  (one chunk per area); loaders and query options stay in the start chunk. Keep query options
  out of screen modules, or the screen (and its imports) lands in the start chunk again.
  `"sideEffects"` in `apps/web/package.json` lets unused feature re-exports drop.

- Deploy: `deploy/Dockerfile` builds `api` and `web` images; `web` is Caddy with the SPA and
  history fallback for non-file, non-API paths; `compose.yml` has no separate proxy service.
  `compose.local.yml` publishes the database for `bun run e2e --stack`. `deploy/local-stack.sh up`,
  `validate` (12 checks incl. route fallback) and all 22 journeys with `--stack` pass. On this
  machine 127.0.0.1:5434 was taken, so `deploy/local.env` used `DB_PORT=5435` and the project
  name `csk-hub-ticket7`.
- Docs: README, AGENTS, CONTRIBUTING, codebase-structure, i18n, api-client, deploy, notifications,
  realtime, authz READMEs; draft ADR 0013; ADR 0012 updated for two images.

Next: merge the integration tip, run the full suite, push; then code review.

Open items:
- `.github/workflows/ci.yml` still sets `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and runs root-level
  commands; left alone (no CI changes by user rule).
- Better Auth rate limiting behind Caddy falls back to one shared bucket (no trusted client-IP
  header configured); the stack journeys wait out 429s on sign-in.
- `publish-image.sh`/`deploy-image.sh` updated for two images but untested against a registry
  and Portainer (GUD work is deferred).

# Codebase Structure

This guide records the structural preferences for CSK Hub. Future changes should preserve these patterns unless a feature needs a deliberate exception. Explain exceptions in the PR; significant architectural decisions follow the ADR guidance in [CONTRIBUTING.md](../CONTRIBUTING.md#architectural-decision-records).

For naming, function style, and TSDoc, see [code-style.md](code-style.md). Use the [contribution guide's reading index](../CONTRIBUTING.md#which-guide-to-read) to select other documentation relevant to the task.

## Contents

- [Design vocabulary](#design-vocabulary)
- [Workspace packages](#workspace-packages)
- [Feature modules](#feature-modules)
- [Dependency direction](#dependency-direction)
- [Drizzle schema](#drizzle-schema)
- [Database operations](#database-operations)
- [Screens and routes](#screens-and-routes)
- [Reuse and duplication](#reuse-and-duplication)
- [UI quality](#ui-quality)
- [Tests](#tests)

## Design Vocabulary

Use the `codebase-design` vocabulary when discussing structure:

- **Module**: anything with an interface and an implementation.
- **Interface**: everything callers must know to use a module correctly, including invariants and error modes.
- **Seam**: where a module's interface lives and where behavior can vary.
- **Adapter**: a concrete implementation that satisfies an interface at a seam.
- **Depth**: leverage at the interface; prefer small interfaces that hide meaningful behavior.
- **Locality**: changes should concentrate in one place rather than spreading across callers.

Avoid shallow pass-through modules. A module earns its place when deleting it would push complexity back into multiple callers.

## Workspace Packages

The repository is a Bun workspace (isolated linker). Each package declares its own dependencies,
tsconfig and tests, and builds on its own:

- `apps/api` (`@csk-hub/api`): the Hono API on Bun, the maintenance CLI (`src/cli`), the Drizzle
  schema and migrations (`drizzle/`) and the local database CLI (`scripts/dev`).
- `apps/web` (`@csk-hub/web`): the Vite React SPA (TanStack Router and Query).
- `packages/shared` (`@csk-hub/shared`): code both applications run: domain models and their enum
  value lists, form schemas, the rich-text document schema, locales and the translation
  catalogues (`src/messages`). It imports nothing from the apps and uses relative imports only.
- `packages/contract` (`@csk-hub/contract`): the OpenAPI document and the generated client. Run
  `bun run api:generate` after changing route schemas and commit the result.
- `e2e/` (root): the Playwright journeys; `deploy/`: packaging and the Compose stack.

Inside each app `@/*` is that app's `src`; shared and contract code is imported as
`@csk-hub/shared/<path>` and `@csk-hub/contract/<path>`. The web app reaches the API only over
HTTP through the contract: it cannot import API modules, so types for API data come from the
contract (see `apps/web/src/core/api-client/README.md`). Put a module in `packages/shared` only
when both applications run it.

Each package mirrors the `src` layout below, so a feature may have files in all three: its
operations and HTTP routes in `apps/api/src/features/<name>`, its screens and queries in
`apps/web/src/features/<name>`, and its model in `packages/shared/src/features/<name>`.

## Feature Modules

Prefer feature-oriented modules for product behavior. A future feature should keep its domain logic, write operations, read helpers, tests, and feature-specific UI close together instead of scattering them by technical layer.

Each package's source tree uses these top-level areas:

- `src/core`: app infrastructure, app shell wiring, and external adapters.
- `src/app` (web): the route tree (`router.tsx`), the app shell layouts and the lazily loaded page
  modules (`pages/`).
- `src/api` (API): the HTTP API's composition root. `createApi` mounts Better Auth and feature
  routers; `runtime.ts` binds it to the database; `server.ts` serves it. Nothing else imports it.
- `src/cli` (API): the maintenance CLI shipped in the API image.
- `src/shared`: cross-feature presentation primitives and generic helpers.
- `src/features/<feature-name>`: product and domain behavior.

Use `src/features/<feature-name>` for durable product capabilities, not route groups or user roles. For example, `admin` is a surface, not a feature.

Every feature lives under `src/features`; none sit at the `src` root. The grouping is not about the individual feature — the `features` segment says nothing `user-management` does not already say. It is about the root: it keeps the number of top-level areas fixed as the product grows, and it gives features a shared path prefix, which is what makes the rules under Dependency Direction expressible as tests rather than maintained by convention.

Use `src/shared` only for genuinely cross-feature modules:

- `src/shared/ui/base`: reusable design-system primitives and low-level controls.
- `src/shared/forms`: reusable form types and generic form presentation helpers.
- `src/shared/hooks`: cross-feature client hooks.
- `src/shared/utils.ts`: stable generic utilities such as `cn`, used by generated UI components.

Use `src/core` for infrastructure and app shell modules:

- `src/core/auth`: Better Auth setup, server/client auth objects, plugins, cookie integration, and auth infrastructure tests.
- `src/core/authz`: application authorization. `@/core/authz` holds denial errors and types; the
  API resolves authority per request through `src/core/http`. Pure policies evaluate feature-supplied resource and relationship
  attributes; only actor resolution reads the database. It depends on auth and database schemas,
  never features. See
  [authorization adoption](authorization.md) before migrating existing guards.
- `src/core/db`: database client and schemas.
- `src/core/http`: framework-neutral API infrastructure: `createRouter` for feature routers,
  stable error codes, and the request context that resolves fresh authority from explicit
  request headers. A feature exposes its operations by exporting a router from its public
  entrypoint; `src/api` mounts it under `/api/v1` (Member ID keeps its released
  `/api/member-id` paths). Run `bun run api:generate` after changing
  route schemas and commit `packages/contract`. A feature puts its router in an `http/`
  subfolder with its own `index.ts`. Feature operations take the request's resolver or context
  explicitly.
- `src/core/api-client` (web): the web application's only way to authoritative behaviour: the
  generated client (`@csk-hub/contract/client`) bound to the browser (`browserApiClient`).
- `src/core/email`: email delivery adapters.
- `src/core/i18n`: locale definitions, the locale cookie, the `use-intl` integration and
  translation loading. See `packages/shared/src/core/i18n/README.md` before adding translated UI.
- `src/core/preferences`: the application-wide user-preferences contract, including storage, runtime validation, backward-compatible defaults, and atomic partial updates used by app-shell and feature modules.

Do not promote code to shared space just because two files currently look similar. Promote only when the interface is stable and the shared module improves locality.

### Internationalization

Locale infrastructure belongs in `src/core/i18n`; translation catalogs are application-wide assets in `packages/shared/src/messages/`. Add user-facing copy to every supported catalog in the same change. Read the [i18n guide](../packages/shared/src/core/i18n/README.md) when changing copy, locale behavior, or translation integration; it owns the detailed conventions.

### Workflow-local structure

Keep a feature folder at its current level when it represents one coherent product capability, but group files inside it by meaningful workflow when that improves locality. Do not create folders mechanically or based on a fixed file-count threshold.

For example, a groups management feature may eventually be organized like this:

```text
src/features/groups/
  collection/
  detail/
  hierarchy/
  index.ts
```

The subfolders are illustrative workflow boundaries, not a required template. Shared group-specific actions, schemas, helpers, or types may remain at the `groups/` root when they genuinely serve multiple workflows. A folder should earn its place by keeping related changes together and reducing the knowledge required by callers.

### Feature guides

A feature may carry a `README.md` at its root for rules a reader cannot infer from the code around them — usually an obligation imposed from outside the feature, such as an ADR the feature has to keep satisfying. Keep it to what the code cannot say for itself; conventions that hold across the whole tree belong in this guide instead.

- [`apps/web/src/features/rich-text/README.md`](../apps/web/src/features/rich-text/README.md): how a feature consumes the editor, and how to add a node or mark to it — three lists and a stylesheet, no consumer changes.
- [`apps/api/src/features/org-structure/README.md`](../apps/api/src/features/org-structure/README.md): the rules the org-structure module enforces because the database cannot, and why application code writes its tables only through it.
- [`apps/api/src/features/events/README.md`](../apps/api/src/features/events/README.md): the rules the events module enforces because the database cannot, and why its commands check no permissions.

## Dependency Direction

Dependencies should point inward toward stable infrastructure and generic helpers:

- `src/app` may import `src/core`, `src/shared`, and feature public entrypoints.
- Feature modules may import `src/core` and `src/shared`.
- A feature may import another feature only through that feature's public entrypoint.
- `src/shared` may import other `src/shared` modules, but not `src/core` or `src/features`.
- `src/core` may import other `src/core` modules and `src/shared`, but not `src/features`.
- Both apps may import `packages/shared`; it imports neither app. Only the web app imports
  `packages/contract`'s client (the API's own tests use it as an HTTP client).

Prefer public entrypoints at feature and subfeature boundaries. Route files should import screens from entries such as `@/features/user-management`, not from deep implementation files like `@/features/user-management/users-screen`. Inside a feature or subfeature, local imports may target sibling implementation files directly.

## Drizzle Schema

Keep Drizzle schema files split by ownership under `apps/api/src/core/db/schema`. A model enum's value list lives in the shared model (for example `EVENT_TYPES`), and the schema's `pgEnum` takes it.

- Auth-owned models stay in `auth.ts`.
- Choir organization models stay in their own schema file.
- Do not mix unrelated future module models into an existing schema file just because Drizzle allows it.
- Generated Drizzle client must not be hand-edited.

When a model decision is hard to reverse or establishes an important domain rule, use an ADR in `docs/adr/`, following [CONTRIBUTING.md](../CONTRIBUTING.md#architectural-decision-records).

## Database Operations

Database infrastructure — the client, schemas and TLS policy — belongs in `apps/api/src/core/db`. Application code consumes `POSTGRES_URL` and never chooses between local and production; see `apps/api/src/core/db/README.md`.

Local database tooling — migrations, Studio, reset and seeding — belongs in the dev CLI in `apps/api/scripts/dev`, which refuses any database that is not local; see its README. Commands that run in a deployed environment (migrate, org bootstrap, Admin bootstrap and recovery) are application code in `apps/api/src/cli` and ship in the API image. Packaging and hosting belong in `deploy/`; see `deploy/README.md` and ADR 0012.

## Screens And Routes

Keep route definitions thin. `apps/web/src/app/router.tsx` declares each page's path, access
gate and loader; the page's screen loads lazily from an area module in `src/app/pages/`, which
composes feature screens. A route file should not become the main implementation of a feature.

For screens with real behavior, split along meaningful seams:

- route: path, access gate and the loader that fills the query cache
- screen module: page-level layout and workflow orchestration
- feature UI modules: reusable or locally composed UI sections
- query modules (`queries.ts`): TanStack Query options over the generated client
- API operations: mutations, validation, authorization and persistence, behind HTTP routes

Keep query options out of screen modules: the router imports them statically, and a screen
module it touches lands in the start bundle with everything the screen imports.

Prefer small, named UI modules when they protect locality. Avoid splitting JSX mechanically into tiny fragments that do not reduce knowledge required by callers.

### Read functions

Expose focused read functions directly rather than collecting unrelated screen reads in a broad query object. Names should describe the workflow and contract, such as `listGroupCollection`, `getGroupDetail`, or `getGroupHierarchy`.

Each read function should serve one caller or one coherent workflow and return a deliberately shaped result. A screen-shaped result is appropriate when it keeps persistence and composition details behind the module boundary; “focused” does not mean that every caller must assemble raw entity data itself. Separate workflows should have separate read functions even when they share lower-level service operations.

Focused reads improve locality, make data dependencies explicit, reduce accidental over-fetching, keep return types understandable, and give each workflow a stable testable seam. Avoid a single query function or return type that combines the needs of collection, detail, hierarchy, and other unrelated screens.

### Caching and the session

Loaders call `ensureQueryData`, so a revisited page renders from the cache and refreshes in the
background. Real-time events invalidate the queries they affect; nothing refetches on focus or a
timer. The web app loads the session once at start (`core/auth/session`); sign-in, sign-out, a 401
and an account-status event reload it. The session only shapes routing and presentation.

### Authority in the API

API operations call `c.var.resolveRequest()` once per operation, which validates the session named
by the request's own headers through `readFreshSession` and reloads the User, then use the
returned authorization. `requirePermission` establishes authority and returns the authenticated
actor, while `can` supplies UI hints. Messaging uses `app.access` for fresh active identity, then
applies its own Conversation access rules. See [the adoption guide](authorization.md) for
transaction and resource requirements. Never pass cached session claims or submitted actor IDs as
authority, and do not cache an authorization result. Direct `auth.api.getSession()` calls stay
confined to `apps/api/src/core/auth/request-session.ts`.

## Reuse And Duplication

Avoid duplicate business rules, validation rules, Drizzle query shapes, and UI interaction patterns. Extract a module when reuse creates a stable interface and reduces future edits.

Do not extract too early:

- Two similar call sites can stay duplicated while the concept is still unclear.
- Three or more similar call sites should trigger a design check.
- Cross-feature duplication should be reviewed with the deletion test before extracting.

## UI Quality

Design mobile-first and responsive from the first implementation pass. Screens should work well on narrow viewports before desktop refinements are added.

Prioritize existing shadcn/ui-style components from `apps/web/src/shared/ui/base` for common controls, layout primitives, dialogs, menus, tables, forms, feedback, and navigation. Add or adapt reusable UI primitives there when the pattern is genuinely shared; keep feature-specific compositions inside the feature module.

Prioritize fast perceived feedback:

- use pending states for mutations
- use optimistic updates when the rollback behavior is clear
- keep navigation and form interactions responsive
- avoid blocking the whole page when a smaller pending state is enough

Prefer composable, editable UI over one large TSX file. If changing a repeated visual or workflow pattern would require edits in several files, introduce or reuse a deeper UI module.

## Tests

Test through module interfaces. If a test needs to reach into implementation details, reconsider the module shape.

Prefer focused tests for domain logic, validation, authorization, write behavior, and meaningful query transformations. Routine unit tests for `.tsx` files and presentational components are not required. UI tests should cover meaningful user-visible workflows and regressions rather than snapshots or implementation details.

Use a limited number of high-value end-to-end tests for important workflows. Add a lower-level UI test only when it protects a durable user-visible regression that is not better covered through end-to-end testing. Temporary implementation-specific UI tests may be useful during development, but should be removed afterward unless they protect such a regression.

When adding a seam, only introduce an adapter abstraction when at least two adapters are real or imminent. One adapter usually means the seam is hypothetical.

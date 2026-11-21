---
status: proposed
---

# A Bun workspace with independently built API and web applications

The repository is a Bun workspace: `apps/api` (the Hono API, its CLI, schema and migrations),
`apps/web` (the Vite SPA), `packages/shared` (code both applications run) and
`packages/contract` (the OpenAPI document and the generated client). Each package declares its
own dependencies and builds on its own, and the web app reaches the API only over HTTP through
the contract. Files keep their `src/...` layout inside their package, so one feature may have
API, web and shared parts at the same relative path.

We install with Bun's isolated linker. Hey API's generator needs TypeScript 6 as a peer while the
applications use TypeScript 7; the hoisted linker resolves the peer to the root TypeScript 7.
The isolated linker gives `packages/contract` its own TypeScript 6. (It used to break
`next build`; Next.js is gone.)

The API and web app ship as separate images: the API image runs `migrate` and `api`; the web
image is Caddy serving the static build, with history fallback for web paths only and API paths
proxied to `api`, so browsers see one origin.

## Consequences

- The web app cannot import API modules. Web types for API data come from the generated contract,
  and a module moves to `packages/shared` only when both applications run it.
- Shared models own enum value lists (for example `EVENT_TYPES`); the Drizzle schema takes them.
- A release is a pair of images published from one commit. The web image inlines
  `VITE_VAPID_PUBLIC_KEY`, so a new VAPID key pair needs a new web image.
- Each package carries its own tsconfig path aliases (`@/*` for its own `src`,
  `@csk-hub/shared/*`, `@csk-hub/contract/*`), mirrored in Vite's config.

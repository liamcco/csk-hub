# Web API client

The web application reaches authoritative behaviour only through Hub's HTTP API, using the client
generated into `contract/client` (import it as `@contract/client`).

- `server.ts` — `getServerApiClient()` for server components and temporary Server Action
  adapters. It calls the API at the configured Hub origin with the incoming request's cookie and
  `Origin`, never caches, and never derives the target from the request's `Host` header.
  `readForScreen()` maps 401 to the login redirect and 403/404 to the not-found page.
- `browser.ts` — `browserApiClient` for client components. Same-origin requests with the session
  cookie; the browser supplies `Origin` on writes.
- `result.ts` — `ApiRequestError` and `errorCode()` for branching on stable error codes.

Feature screens must not import `@/core/db` or feature services. After a write, refresh the
affected screens (`router.refresh()` today; query invalidation once the web app moves to TanStack
Query).

# Web API client

The web application reaches authoritative behaviour only through Hub's HTTP API, using the client
generated into `packages/contract/client` (import it as `@csk-hub/contract/client`). The web
package cannot import API modules; types for API data come from the contract.

- `browser.ts`: `browserApiClient`. Same-origin requests with the session cookie; the browser
  supplies `Origin` on writes.
- `result.ts`: `read()` unwraps a read for a query, throwing `ApiRequestError` (status and stable
  error code); `isUnauthenticated`/`isUnavailable` classify failures for the router;
  `QueryData<typeof someQuery>` names the data a query resolves to.
- `capabilities.ts`: the signed-in User's capabilities, as UI hints only.

Each feature keeps its query options in a `queries.ts` beside its screens, never inside a screen
module (the router imports query options statically and screens lazily). After a write, invalidate
the affected queries or call `useAppRouter().refresh()`; real-time events invalidate them too
(`apps/web/src/app/layouts.tsx`).

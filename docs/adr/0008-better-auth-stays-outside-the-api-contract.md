---
status: proposed
---

# Better Auth stays outside the API contract

The Hono API mounts Better Auth's handler unchanged under `/api/auth/*`. Clients call those
endpoints through Better Auth's own client (`src/core/auth/auth-client.ts`), not through the
generated client. The OpenAPI contract in `contract/openapi.json` describes only the
application's operations under `/api/v1`, plus the existing Member ID paths as they move.

Better Auth owns sign-in, sessions, cookies, trusted origins, CSRF checks, passkeys, two-factor,
magic links and its admin endpoints. Its client already tracks those endpoints and their plugin
types release by release. Copying them into our contract would make us maintain a second,
drifting description of behaviour we do not own, and a hand-written proxy could weaken its
origin and cookie checks.

## Consequences

- Every host builds its instance with `createAuth`, so identity rules cannot diverge. Only the
  Next.js instance adds `nextCookies()`; the API's instance has no Next.js dependency.
- Application operations never take identity from the body. They resolve a fresh session and
  actor from the request's own cookies (`resolveRequest`), which reloads the User so revocation,
  expiry, deactivation and role changes apply to the next protected operation.
- `GET /api/v1/me` (`getCurrentActor`) is the contract's view of identity: trusted actor facts,
  not Better Auth's cached session. Clients use it after a 401 or account-status event.
- Better Auth's own OpenAPI reference (`/api/auth/reference`) remains available for its endpoints.
  A native client that cannot use the Better Auth client needs a separate decision.

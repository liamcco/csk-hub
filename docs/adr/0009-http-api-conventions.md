---
status: proposed
---

# HTTP API conventions

The OpenAPI 3.0.3 contract is generated from Hono Zod OpenAPI route schemas, and the TypeScript
client from that contract with Hey API. Both are committed under `contract/`; CI fails when a
clean `bun run api:generate` changes them. The schemas are the source of truth, so these rules
apply to them:

- **Paths.** Application operations live under `/api/v1`. Existing public paths, such as
  Member ID's, keep their current URLs and representations.
- **Operation IDs.** Every route sets `operationId`: lower camelCase, verb then noun, unique
  across the API (`getCurrentActor`, `listEvents`, `publishPost`). It names the generated SDK
  function, so it never changes once released.
- **Errors.** Failures return JSON `{ "code": "<CODE>" }` with a stable upper-snake-case code
  from `core/http` (`UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`, `INTERNAL`)
  or a feature-specific code added to the route's documented responses. Clients branch and
  translate on the code; there is no human-readable message in the contract. Validation failures
  add `issues: [{ path, code }]`, where `code` is a Zod issue code or a validation message ID.
  Authorization denials disclose nothing: no actor is 401, any other denial 403, and a feature
  answers 404 where existence itself is private.
- **Timestamps.** Instants are RFC 3339 strings in UTC with a `Z` suffix (`date-time`).
  Calendar dates without time are `YYYY-MM-DD` (`date`). Never epoch numbers or local offsets.
- **Pagination.** Collections that can grow use opaque cursors: request `?cursor=&limit=`, response
  `{ "items": [...], "nextCursor": string | null }`. `null` means the end. Small bounded
  collections return a plain `items` array. No offset pagination or total counts by default.
- **Nullability.** Response fields are always present. An absent value is `null`, declared
  `nullable`; fields are never omitted to mean "none". Request fields may be optional; an
  optional field that is omitted means "unchanged" and `null` means "clear".
- **Caching.** Every `/api/v1` response is `Cache-Control: private, no-store`, because each is
  personalised by the caller's session.

## Consequences

Routes document their failures with `errorResponses` from `core/http` so error shapes stay
uniform. New conventions are added here before the first route needs them.

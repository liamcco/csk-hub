---
status: proposed
---

# Installed-client compatibility

Installed clients, such as the iPhone companion, cannot be updated in step with the server. The
web app ships with the API and can be. Released operations therefore change only additively:

- Allowed within `/api/v1`: new operations, new optional request fields, new response fields,
  new error codes and new enum values. Clients must ignore unknown fields, treat unknown error
  codes as a generic failure and tolerate unknown enum values.
- Not allowed: removing or renaming an operation, path, field or code; making a request field
  required; changing a field's type, nullability or meaning; tightening validation for input
  that was accepted.
- A breaking change ships as a new operation (or `/api/v2` path) beside the old one. The old one
  is marked `deprecated: true` in the contract and keeps working until the supported clients no
  longer use it.
- Member ID's existing paths and representations are frozen as they are; changes follow these
  rules and are covered by HTTP contract tests using the existing client's request shapes.

Rollout order: deploy the server change first, then release clients that use it. Remove a
deprecated operation only after the oldest supported client release no longer calls it,
confirmed from request logs. Until clients report their version, supported clients are those
released within the previous six months.

## Consequences

Reviewers check the contract diff in `contract/openapi.json` for removals and type changes.
Version reporting (for example a client version header) and an automated breaking-change check
are deferred until a second installed client exists.

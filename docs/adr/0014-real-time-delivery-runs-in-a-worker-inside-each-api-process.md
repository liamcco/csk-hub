---
status: proposed
---

# Real-time delivery runs in a worker inside each API process

Each API process starts one supervised delivery worker (`startActivityWorker`,
`apps/api/src/core/realtime`). It drains the Postgres delivery outbox at startup, after a local
commit wakes it, at the next publication, push, retry or lease deadline (on the database clock),
and on a five-second idle poll that finds work committed by other processes. Runners claim rows
with `FOR UPDATE SKIP LOCKED` and ninety-second leases, so any number of API processes share the
outbox without coordinating. Publication and Web Push retry with backoff from one second to a
minute; Web Push gives up after twelve claims. On `SIGTERM` the worker finishes its wave and
releases its leases.

Before the migration, delivery ran in Next.js `after()` callbacks, so pending work and retries
waited for the next activity request and nothing ran while the app was idle. A standalone Bun
process has no such limit. A worker inside the API process needs no extra service, image or
deploy step, and Postgres stays the only source of truth for what is pending; Redis only carries
outbox IDs to open streams.

## Consequences

- Every API runner also delivers. Scaling the API scales delivery; there is no way to run one
  without the other.
- A delivery wave shares the event loop with requests. Waves are bounded (five concurrent rows,
  fifty per dispatch, twenty seconds per dispatch).
- An idle runner queries the outbox every five seconds.
- Without `REDIS_URL` the worker does nothing, and real-time delivery is off.
- If delivery ever needs its own capacity, the worker can move to a separate entrypoint of the
  same image without changing the outbox.

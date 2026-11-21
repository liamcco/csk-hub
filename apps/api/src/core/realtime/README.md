# Real-time delivery

CSK Hub uses standard SSE and Redis Streams. Better Auth authenticates the app-owned
endpoint; browsers never connect to Redis or receive broker credentials. Postgres
stores Messages, read cursors and a transactional per-User delivery outbox. Recipient
Redis streams carry only outbox IDs, with approximately 1,000 entries and 24-hour expiry.
Redis is not the source of truth: pending deliveries and scheduled deadlines live in
Postgres. A supervised worker in each API process delivers it, independently of incoming
requests.

## Ownership

`core/realtime` owns the shared delivery system: event contracts, transactional enqueue,
Redis transport, authenticated SSE, acknowledgement handling, push fallback, retries,
retention, post-response scheduling and the app-wide browser connection. It imports no features.

`createRealtimeRouter(policy)` (`http.ts`) binds the HTTP endpoints to required feature checks
for current delivery access and authoritative read state. The API (`src/api/app.ts`) mounts it
at `/api/realtime` with `conversationActivityPolicy` from the public
`features/messaging/activity` entrypoint, behind the same Hub Origin guard as `/api/v1`.
`GET /api/realtime/events` is the event stream (frames documented as `ActivityStreamFrame` in
the OpenAPI contract, typed by `activityStreamFrameSchema` in `events.ts`) and
`POST /api/realtime/ack` the acknowledgement. Both read the session afresh through the API's
request resolution, then recheck the stored session; impersonated sessions get neither.
Messaging owns Conversation membership, read-cursor rules and its policy-bound dispatch
function. Other features call that dispatch entrypoint after commit; notification broadcast
owns recipient search, delivery-mode selection and queued-versus-sent results. The policy is passed
explicitly, with no global registration or permissive default for protected deliveries.

The integration suite stays in `features/activity` because it verifies the composed
Messaging/Post workflows. Transport and scheduling tests live beside their core modules.

## Setup

1. Run `docker compose -f deploy/compose.dev.yml up -d` locally to start PostgreSQL and Redis 7.
2. Run `bun run db migrate` to apply the delivery migration and earlier migrations.
3. Configure `REDIS_URL=redis://localhost:6379` and
   `REDIS_KEY_PREFIX=csk-hub-development` in `.env`. Leave `REDIS_URL` unset to disable
   realtime. Use a different database and prefix in production, preview and development.
4. Run `bun run dev`. The API process starts its delivery worker at startup, in development as in
   the local Compose stack (`deploy/local-stack.sh`).

## The delivery worker

A feature saves its data and delivery records in one Postgres transaction. After commit, the
route calls `scheduleDelivery()`, which wakes the process's worker (`startActivityWorker` in
`worker.ts`). Message writes do not wait for delivery. Draft-only Post changes, unchanged read
cursors and exact Message retries do not wake it.

The worker starts with the API process and drains pending work at once, so work left by a
crashed or stopped runner resumes on startup without any request. It then waits for the next
publication, push, retry or lease-expiry deadline (measured on the database clock), a wake from a
local commit, or its idle poll (five seconds), which finds work committed by other processes.

Each wave atomically claims up to five rows with `UPDATE ... RETURNING` and a
`FOR UPDATE SKIP LOCKED` subquery, then processes them concurrently. Conversation changes
take priority over public fan-out. Up to 50 rows are processed per batch. Ninety-second leases
coordinate any number of runners: a runner never claims a leased row, and an abandoned lease
becomes claimable when it expires. Transient database failures retry with backoff (one to eight
seconds). Publication and push failures retain their own retry deadlines, doubling from one
second to at most a minute per attempt, until the record is delivered or expires. Redis
publication failures do not prevent due Web Push.

On `SIGTERM` the API ends open event streams (browsers reconnect, to another runner if there is
one), stops claiming, finishes the current wave, releases its leases, finishes in-flight requests
and exits. Work that remains stays in Postgres for the next runner.

Retention runs at most hourly per runner: records older than seven days expire, including
unfinished deliveries. `realtime.delivery.expired` reports unfinished records removed. Every
minute the worker logs `realtime.worker.pending` with the pending count and the age of the oldest
pending record, or `realtime.worker.backlog` at warning level once that age passes two minutes.
Delivery failures log `realtime.publish.retry`, `realtime.push.retry` and
`realtime.delivery.retry`; batches `realtime.dispatch.batch`; database failures
`realtime.dispatch.retry`; and lifecycle `realtime.worker.started|stopped`. Logs do not include
message text or credentials.

## Deployment

Use a reachable Redis 7+ server supporting standard `EVAL`, `XADD`, `XREAD`,
`XREVRANGE` and `EXPIRE`. Use authenticated TLS (`rediss://`) for remote Redis, and
place it near the application and database. Each open browser stream owns a blocking
Redis connection. Size connection capacity for concurrent tabs and devices, plus short-lived
publisher connections. Browser delivery uses independent cursors, not a consumer group
that would divide events between a User's tabs.

Configure the application's validated environment (`POSTGRES_URL`, `REDIS_URL`,
`REDIS_KEY_PREFIX` and VAPID keys). The standalone API (`deploy/compose.yml`, service `api`)
serves the endpoints and runs the worker; no other process is needed, and more API runners
share the outbox through leases. The proxy must stream `/api/realtime/*` without buffering or
compression, with an idle timeout above the 15-second heartbeat (`deploy/Caddyfile`); Bun's own
idle timeout is set to 60 seconds for the same reason.

The stream rotates its connection after four minutes. Heartbeats occur at most every 15 seconds and native EventSource reconnects
with `Last-Event-ID`. The `ready` event carries a `reset` flag: initial connections and
invalid, future or trimmed cursors request an authoritative refresh. A retained cursor
resumes through replay without refreshing an unchanged page. Focus and network recovery
still refresh the current authorized state.
Redis failures do not roll back a committed Message: publication retries with backoff,
and due offline push can still proceed independently. Slow readers are
disconnected when the stream buffer exceeds its bounded capacity.

If Redis is unavailable when establishing a stream, the endpoint returns a short valid
SSE response with a five-second retry interval and closes it. This keeps native browser
reconnection active; returning an HTTP error could permanently stop EventSource instead.
There is currently no disconnected-status banner or fallback browser polling. Open
screens can remain stale during an outage; ordinary database reads and writes continue.

Each stream checks the underlying session and account, bypassing the Better Auth cookie
cache, at connection, heartbeat and before exposing a received batch. Message-related
events also recheck current Conversation access. Impersonation cannot subscribe or
acknowledge on another User's behalf. Redis payloads contain no Message text.

## Notification behavior

- In the visible current Conversation, activity refreshes the timeline. The existing
  signed rendered-history token advances the read cursor and acknowledges pending
  Message notifications through that sequence.
- Elsewhere in a visible app, a linked toast acknowledges delivery without marking the
  Conversation read. Browser Web Locks and local storage deduplicate across tabs where
  available. Hidden tabs defer feedback and never acknowledge merely receiving an event.
  Deferred toasts expire at the server-supplied push deadline; returning later still refreshes
  authoritative state without presenting the stale alert.
- After an eight-second grace period, the worker sends Web Push if no visible
  handling acknowledgement or authoritative read cursor makes it unnecessary. Handling on any
  device suppresses fallback across that User's devices. Web Push still requires an
  active subscription; in-app feedback does not. This grace-and-fallback behavior applies
  to Messages.
- Admin broadcasts retain direct bulk Web Push, with the low-level sender limiting
  concurrent provider calls. With Redis configured, they also queue in-app feedback with
  no outbox push fallback, so dispatch cannot send a second push. Broadcasts can produce
  both push and visible feedback; they do not use Message-style push suppression. Members
  without push subscriptions can still receive queued in-app feedback. Deferred broadcast
  toasts expire eight seconds after creation.
- Acknowledgement-versus-push races, or a crash after provider acceptance but before
  recording success, can cause a duplicate. The stable notification tag helps browsers
  replace duplicates. Retries continue until the record expires; provider acceptance
  cannot establish that the operating system displayed a notification.
- Outbox claims expire after 90 seconds, failed work backs off up to 60 seconds, and
  delivery records expire after seven days. Monitor `realtime.*` logs and pending work
  during outages; database backups remain separate operational work.

Unread state propagates across tabs/devices, including sending a Message. Post publication,
editing and unpublication refresh the feed and badges without exposing Draft content.
A one-shot timer handles the 30-day unread horizon and future publication timestamps.
Refreshing an older Message-history page preserves that window, composer and scroll;
new activity offers a link to the current Conversation.

## Verification

`bun tst` includes a process-isolated integration suite against a newly created local
throwaway Postgres database and a unique Redis key prefix, with Web Push replaced by a controlled
mock. Start both local services to run those tests; they skip when either is unavailable. Streams
and acknowledgements go through the API with Better Auth sessions. Tests cover atomic enqueue,
send retries, live SSE/replay, documented frames, acknowledgement privacy, impersonation and
foreign origins, unread semantics, broker failure, Group departure, revoked sessions, Post
changes, chat priority, concurrent delivery bounds, direct bulk broadcast push and
reset-versus-replay handshakes. Worker tests cover recovery on startup, abandoned leases,
polling for work committed elsewhere, two concurrent runners delivering each record once, the
eight-second push grace, acknowledgement during that grace, push retry with backoff, stopping
without leaving leases, and pending-work metrics. Scheduler tests run without local services and
cover wake/query races, retry backoff, waiting for deadlines, stopping mid-wave and disabled
realtime. `deploy/local-stack.sh validate` checks streaming, restart and abandonment,
concurrent runners, acknowledgement suppression and retry through the proxy.
The service-worker tests run the actual script against rejected or unavailable
window navigation and verify that a target still opens.

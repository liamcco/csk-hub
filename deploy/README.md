# Deployment

How CSK Hub is packaged and hosted: two release images (API and web), a Compose stack that runs
them, and the scripts that publish and deploy them. The decision behind this layout is
[ADR 0012](../docs/adr/0012-packaging-lives-in-deploy-and-operations-ship-in-the-image.md).
The `csk-hub-dev` project can also deploy the SPA and HTTP API on [Vercel](#vercel).

## Vercel

Link the GitHub repository to one Vercel project with the repository root as its Root Directory
and `main` as its Production Branch. Select **Vite** and **Node.js 24.x** and turn off the
dashboard overrides for Install Command, Build Command, and Output Directory. The root
[`vercel.json`](../vercel.json) sets those commands and the SPA fallback. The build command runs
the root `vercel-build` script first, which bundles the API to `apps/api/dist/vercel.mjs` for the
JavaScript handler in `api/` to import, then builds the web app. The existing workspace typecheck
still uses TypeScript 7.

Enable **Automatically expose System Environment Variables**. Configure these variables for
the deployment environments you use.

| Variable | Value |
| --- | --- |
| `BETTER_AUTH_URL` | Production's canonical HTTPS origin. Preview uses Vercel's deployment and branch hostnames. |
| `BETTER_AUTH_SECRET` | The Better Auth secret for the environment. |
| `POSTGRES_URL` | The environment's pooled database connection. The existing TLS policy trusts Supabase's CA. |
| `REDIS_URL`, `REDIS_KEY_PREFIX` | A reachable Redis 7+ connection for realtime. Use `rediss://` for remote Redis and distinct prefixes for Production and Preview. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | A valid matching key pair for push. |
| `VITE_VAPID_PUBLIC_KEY` | The same value as `VAPID_PUBLIC_KEY`. Vite embeds it at build time. |
| `EMAIL_MODE`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Use `smtp` and the provider's STARTTLS settings to deliver invitations, password resets, and email codes. The defaults for host and port are `smtp.gmail.com` and `587`. |
| `CONTACT_EMAIL` | Optional. Preserve the existing value if configured. |

Leave `ENVIRONMENT` unset so the API uses `VERCEL_ENV`. With `REDIS_URL` set, writes that queue
activity schedule a delivery window of up to 30 seconds through `waitUntil()`. Browsers receive
live updates over SSE. Pending work after that window resumes when another write schedules
delivery. Leave `REDIS_URL` unset to disable realtime and all outbox delivery, including push
notifications, which share the same worker.

Apply pending migrations before releasing a commit that needs the new schema. From `apps/api`,
run `bun src/cli/index.ts migrate` with `POSTGRES_URL` set to the target database's direct
connection and a schema-owner credential. Vercel builds and requests use the runtime database
configuration. After the dashboard settings are in place, pushes to `main` deploy automatically.

| File | Purpose |
| --- | --- |
| `Dockerfile` | The release images (targets `api` and `web`). Build context is the repository root. |
| `compose.yml` | The stack: `db`, `redis`, `migrate`, `api` and `web`. |
| `compose.local.yml` | Local stack only: publishes the database on loopback for `bun run e2e --stack`. |
| `Caddyfile` | The web server's routes: API paths to `api`, the SPA's files and history fallback for the rest. |
| `local-stack.sh` | Start, validate, stop and reset the stack locally from this checkout. |
| `validate-stack.ts` | The checks `local-stack.sh validate` runs through the stack's origin. |
| `compose.dev.yml` | Local development PostgreSQL and Redis only, for `bun dev`. |
| `stack.env.example` | The stack's configuration; copy to `stack.env` or enter it in Portainer. |
| `publish-image.sh` | Build, check and publish both images from a clean checkout of one commit. |
| `deploy-image.sh` | Deploy one published pair of images. |

## The release images

The API and the web app build independently, from `deploy/Dockerfile`:

- `api` (`--target api`): Bun with the bundled API (`api.js`, `apps/api/src/api/server.ts`), the
  maintenance CLI (`cli.js`) and the migration SQL (`drizzle/`). There is no Node.js in it.
  `apps/api/src/api/standalone.test.ts` bundles the API the same way.
- `web` (`--target web`): Caddy with the SPA's static build (`apps/web/dist`) and the
  `Caddyfile`. It holds no secrets and needs no database.

Vite inlines `VITE_VAPID_PUBLIC_KEY` into the browser bundle, so the web build requires it as a
build argument: give the stack the same key as `VAPID_PUBLIC_KEY`. A new key pair therefore means
a new web image.

## The stack

`compose.yml` runs everything on the stack's private network. Only `web` publishes a port
(`APP_PORT`); services reach each other by service name (`db`, `redis`, `api:3000`).

| Service | Runs | Connects as |
| --- | --- | --- |
| `db`, `redis` | PostgreSQL 17, Redis 7 | |
| `migrate` | `bun cli.js migrate`, then exits | `csk_hub`, the schema owner |
| `api` | `bun api.js`: `/api/v1`, Better Auth (`/api/auth`), Member ID (`/api/member-id`), real-time (`/api/realtime`) and the outbox delivery worker | `csk_hub_app`, data only |
| `web` | Caddy: the SPA and the API behind it, one origin for browsers and the iPhone companion | |

On every start:

1. `db` and `redis` become healthy.
2. `migrate` applies pending schema and data migrations as the schema owner. It then creates or
   updates the runtime role `csk_hub_app` (password `POSTGRES_APP_PASSWORD`) and grants it row
   access to every application table: it cannot create, alter or drop anything, or read the
   migration ledger. Nothing else happens on deploy; in particular, no default data is written.
3. `api` starts only if `migrate` exited successfully. A failed migration leaves it stopped, and
   `docker compose logs migrate` says why. Pending migrations apply in one transaction, so a
   failed run changes nothing: redeploying the previous image brings the stack back.
4. `web` starts once `api` is healthy.

`web` routes by path: `/api` and `/api/*` go to `api`, which answers unknown API paths with
`404 {"code":"NOT_FOUND"}`. A path ending in a file extension is a static file or a 404; every
other path gets the SPA's `index.html` (history fallback), so bookmarks and deep links load. Hashed
`/assets/*` are cached as immutable; everything else is revalidated. Nothing is compressed or buffered, so
server-sent events stream as they are written. `/api/realtime/*` has its own route with a 60-second
upstream read timeout, above the event stream's 15-second heartbeat (Bun's idle timeout in the
API is 60 seconds too).

The API delivers the real-time outbox in the background, independently of requests: it resumes
pending work on startup and takes over leases abandoned by a stopped runner. Several `api`
replicas can run at once; leases make each record go out once. On stop (`stop_grace_period`
30 seconds) it ends event streams, finishes its current delivery wave and exits. See
[`apps/api/src/core/realtime/README.md`](../apps/api/src/core/realtime/README.md) for the logs to
monitor.

The API accepts unsafe requests only with the public origin (`BETTER_AUTH_URL`), however it is
reached.

The database is reached as `db:5432` with `sslmode=disable`: the connection never leaves the
private network. Everything else in `apps/api/src/core/db/tls.ts` is unchanged.

### Run it locally

Needs Docker and Bun. From the repository root:

```bash
deploy/local-stack.sh up         # build csk-hub-api:local and csk-hub-web:local and start the stack
deploy/local-stack.sh validate   # check it through its origin
bun run e2e --stack              # the browser journeys against it (on a freshly reset stack)
deploy/local-stack.sh logs       # follow the services' logs
deploy/local-stack.sh down       # stop it, keeping its data
deploy/local-stack.sh reset      # stop it and delete its database, Redis and certificate data
```

The Hub is at <https://localhost:8443>. The first `up` writes `deploy/local.env` (ignored by git)
with fresh secrets and VAPID keys; delete it with `reset` to start over. Caddy serves localhost
with a certificate from its own authority, which browsers warn about until it is trusted:
`docker compose -p csk-hub-local cp web:/data/caddy/pki/authorities/local/root.crt .` exports
it. `compose.local.yml` publishes the database on `127.0.0.1:${DB_PORT:-5434}` (set `DB_PORT` in
`deploy/local.env` when that port is taken) for the journeys to seed their Users.

Email is printed to the logs (`EMAIL_MODE=log`). To sign in, create an Admin and open the link
from the printed invitation:

```bash
docker compose -p csk-hub-local exec api bun cli.js admin bootstrap --email you@example.org --name "You"
```

`validate` checks, through the stack's origin: unknown API paths get the API's error; web paths,
bookmarks and deep links get the SPA while missing files answer 404; Better Auth activation and
sign-in for a freshly invited Admin; Member ID issue and verify; a protected write that needs
Hub's `Origin`; the reads a protected page makes; and real-time delivery: an event stream that is neither
buffered nor compressed and outlives its heartbeat interval, acknowledgement suppressing the push
fallback, push retry against a push sink that refuses connections, recovery after an API restart
and from an abandoned lease, two API runners publishing each record once, and publication retry
across a Redis restart followed by replay on reconnect. The real-time checks stop and start the
API and Redis and briefly add containers, so run them against a local stack only.

`up` is also how to apply new migrations: it rebuilds the images and `migrate` runs before the new
`api` starts. The stack's project name is `csk-hub-local`, separate from the development database
in `compose.dev.yml`, so both can run at once.

## Releasing

```bash
deploy/publish-image.sh --ref origin/master            # build, check and push; prints tag and digest
deploy/publish-image.sh --ref origin/master --deploy   # ...and deploy that exact image
deploy/publish-image.sh --ref HEAD --no-push           # build and check only, into local Docker
```

Publishing checks out exactly that commit in a temporary worktree, so nothing uncommitted reaches
the images. It runs lint, typecheck and the tests there, builds both targets for `PLATFORM`
(default `linux/amd64`) and pushes `IMAGE-api:sha-<commit>` and `IMAGE-web:sha-<commit>` (default
`IMAGE` is `ghcr.io/herr-ek/csk-hub`). It needs `VITE_VAPID_PUBLIC_KEY` and prints both pinned
references; deploy by digest.

- Pushing uses Docker's existing registry login: `docker login ghcr.io` with a token that can
  write packages. Automation would use its built-in registry token instead.
- `--deploy` calls `deploy-image.sh` with both published `image@digest` references. It POSTs the
  stack's Portainer webhook (`PORTAINER_WEBHOOK_URL`) with `CSK_HUB_API_IMAGE` and
  `CSK_HUB_WEB_IMAGE` set to them. The webhook
  URL is a deployment credential, configured separately from registry access.
- Without `--deploy`, select the release in Portainer by setting `CSK_HUB_API_IMAGE` and
  `CSK_HUB_WEB_IMAGE` and redeploying.
  Either way, `migrate` runs before the new app starts.

A manually triggered release workflow that calls `publish-image.sh --deploy` is planned but not
added yet; pushing to `master` runs CI only.

## Maintenance commands

The API image ships the maintenance CLI. Run it in the api container's console in Portainer
(or `docker compose exec api ...` locally); it uses that container's data-only database role and
email configuration, and none of its commands takes a target.

```bash
bun cli.js org bootstrap                                              # once, in a new environment
bun cli.js admin bootstrap --email person@example.org --name "Person" # the first or a new Admin
bun cli.js admin recover --email person@example.org                   # an Admin who cannot sign in
```

- `org bootstrap` creates the default Choirs, Sections, Styret, the Gigmästeri and the Position
  catalogue. It does nothing once the environment has any group or Position, so it never
  recreates something Admins archived, renamed or deleted.
- `admin bootstrap` creates the named Admin through Better Auth with no password and sends an
  activation invitation. It does not refuse because another Admin exists. If the account is
  already an Admin, it offers to resend the activation (not yet activated) or a password-reset
  email (`--yes` answers for it without a terminal).
- `admin recover` sends a password-reset email to an existing, active Admin. Members who forgot
  their password use the app's normal reset flow.
- Promoting an existing member, reactivating a deactivated account and resetting two-factor are
  deliberately not here; they stay separate, explicit operations.

### System data

Records the code depends on are system data and change only through versioned migrations. Today
that is only the group *types*, a schema enum. Choirs, Sections, groups and Positions are
editable default data owned by Admins after `org bootstrap`.

## Responsibilities

| Ours | GUD's |
| --- | --- |
| The images, their contents and their CPU target | The host, Docker and Portainer |
| `compose.yml`, `stack.env` values and secrets | The reverse proxy, TLS and the public hostname |
| Publishing and choosing releases | Registry pull access from the host |
| Migrations and maintenance commands | Host-level monitoring and updates |
| Application data correctness | To be agreed: backups and recovery (below) |

Portainer reads `deploy/compose.yml` by its repository-relative path. Confirm on GUD's setup at
production rollout, together with the CPU architecture and the webhook's `CSK_HUB_API_IMAGE` and
`CSK_HUB_WEB_IMAGE` overrides. The publish and deploy scripts are untested against a registry and
Portainer since the split into two images.

## Backups

The `postgres_data` volume persists data across restarts and redeploys. **It is not a backup**:
it lives on the same host, and deleting the stack's volumes, host failure or a bad migration
loses it. Backup and restore are not implemented here. Who backs up what, and how recovery
works, must be agreed with GUD, who may already provide it, before real data is stored.

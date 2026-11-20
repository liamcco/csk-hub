# Deployment

How CSK Hub is packaged and hosted: one release image, a Compose stack that runs it, and the
scripts that publish and deploy it. The decision behind this layout is
[ADR 0012](../docs/adr/0012-packaging-lives-in-deploy-and-operations-ship-in-the-image.md).

| File | Purpose |
| --- | --- |
| `Dockerfile` | The release image. Build context is the repository root. |
| `compose.yml` | The stack: `db`, `redis`, `migrate`, `api`, `web` and `proxy`. |
| `Caddyfile` | The proxy's routes: API paths to `api`, everything else to `web`. |
| `local-stack.sh` | Start, validate, stop and reset the stack locally from this checkout. |
| `validate-stack.ts` | The checks `local-stack.sh validate` runs through the proxy. |
| `compose.dev.yml` | Local development PostgreSQL and Redis only, for `bun dev`. |
| `stack.env.example` | The stack's configuration; copy to `stack.env` or enter it in Portainer. |
| `publish-image.sh` | Build, check and publish an image from a clean checkout of one commit. |
| `deploy-image.sh` | Deploy one published image. |

## The release image

One Bun image runs everything; there is no Node.js in it. It contains the Next.js standalone
server (`server.js`), the standalone API (`api.js`), the migration SQL (`drizzle/`) and the
maintenance CLI (`cli.js`), so each release is one artifact.

`api.js` is `src/api/server.ts` bundled: Hono on Bun with its own database and Redis
connections. It contains no Next.js; `src/api/standalone.test.ts` builds it the same way and
fails if any Next.js module is in its graph.

Next.js runs on Bun without Node. Verified on the local stack: the production build, sign-in,
password reset, the admin and org-structure pages and the maintenance commands. One difference
from Node: Bun logs `unhandledRejection: AbortError` from `node:async_hooks` around some
navigations (the reset-password page and its redirect), which Node does not. Pages and actions
complete normally; the Next.js runtime is being retired, so this is accepted rather than
worked around.

`next build` inlines `NEXT_PUBLIC_VAPID_PUBLIC_KEY` into the browser bundle, so the build
requires it: set it when publishing, and give the stack the same key as `VAPID_PUBLIC_KEY`. A new
key pair therefore means a new image.

## The stack

`compose.yml` runs everything on the stack's private network. Only `proxy` publishes a port
(`APP_PORT`); services reach each other by service name (`db`, `redis`, `api:3000`, `web:3000`).

| Service | Runs | Connects as |
| --- | --- | --- |
| `db`, `redis` | PostgreSQL 17, Redis 7 | |
| `migrate` | `bun cli.js migrate`, then exits | `csk_hub`, the schema owner |
| `api` | `bun api.js`: `/api/v1`, Better Auth (`/api/auth`), Member ID (`/api/member-id`) | `csk_hub_app`, data only |
| `web` | `bun server.js`: the Next.js pages and, until real-time moves to the API, `/api/realtime` | `csk_hub_app`, data only |
| `proxy` | Caddy: one origin for browsers and the iPhone companion | |

On every start:

1. `db` and `redis` become healthy.
2. `migrate` applies pending schema and data migrations as the schema owner. It then creates or
   updates the runtime role `csk_hub_app` (password `POSTGRES_APP_PASSWORD`) and grants it row
   access to every application table: it cannot create, alter or drop anything, or read the
   migration ledger. Nothing else happens on deploy; in particular, no default data is written.
3. `api` starts only if `migrate` exited successfully. A failed migration leaves it stopped, and
   `docker compose logs migrate` says why. Pending migrations apply in one transaction, so a
   failed run changes nothing: redeploying the previous image brings the stack back.
4. `web` starts once `api` is healthy, then `proxy`.

The proxy routes by path: `/api` and `/api/*` go to `api`, which answers unknown API paths with
`404 {"code":"NOT_FOUND"}`; `/api/realtime/*` goes to `web` until the following delivery ticket
moves real-time to the API; everything else goes to `web`. Nothing is compressed or buffered, so
server-sent events stream as they are written.

The web server renders pages from the API at `API_INTERNAL_URL` (`http://api:3000`), forwarding
the caller's cookie and the public origin as `Origin`. The API accepts unsafe requests only with
that public origin (`BETTER_AUTH_URL`), however it is reached.

The database is reached as `db:5432` with `sslmode=disable`: the connection never leaves the
private network. Everything else in `src/core/db/tls.ts` is unchanged.

### Run it locally

Needs Docker and Bun. From the repository root:

```bash
deploy/local-stack.sh up         # build csk-hub:local from the working tree and start the stack
deploy/local-stack.sh validate   # check it through the proxy
deploy/local-stack.sh logs       # follow the services' logs
deploy/local-stack.sh down       # stop it, keeping its data
deploy/local-stack.sh reset      # stop it and delete its database, Redis and certificate data
```

The Hub is at <https://localhost:8443>. The first `up` writes `deploy/local.env` (ignored by git)
with fresh secrets and VAPID keys; delete it with `reset` to start over. Caddy serves localhost
with a certificate from its own authority, which browsers warn about until it is trusted:
`docker compose -p csk-hub-local cp proxy:/data/caddy/pki/authorities/local/root.crt .` exports
it.

Email is printed to the logs (`EMAIL_MODE=log`). To sign in, create an Admin and open the link
from the printed invitation:

```bash
docker compose -p csk-hub-local exec api bun cli.js admin bootstrap --email you@example.org --name "You"
```

`validate` checks, through the proxy: unknown API paths get the API's error and web paths reach
the web server; Better Auth activation and sign-in for a freshly invited Admin; Member ID issue
and verify; a protected write that needs Hub's `Origin`; and a protected page that the web server
renders from the API by service name.

`up` is also how to apply new migrations: it rebuilds the image and `migrate` runs before the new
`api` starts. The stack's project name is `csk-hub-local`, separate from the development database
in `compose.dev.yml`, so both can run at once.

## Releasing

```bash
deploy/publish-image.sh --ref origin/master            # build, check and push; prints tag and digest
deploy/publish-image.sh --ref origin/master --deploy   # ...and deploy that exact image
deploy/publish-image.sh --ref HEAD --no-push           # build and check only, into local Docker
```

Publishing checks out exactly that commit in a temporary worktree, so nothing uncommitted reaches
the image. It runs lint, typecheck and the tests there, builds for `PLATFORM` (default
`linux/amd64`) and pushes `IMAGE:sha-<commit>` (default `ghcr.io/herr-ek/csk-hub`). It prints the
tag and the digest; deploy by digest.

- Pushing uses Docker's existing registry login: `docker login ghcr.io` with a token that can
  write packages. Automation would use its built-in registry token instead.
- `--deploy` calls `deploy-image.sh` with the published `image@digest`. It POSTs the stack's
  Portainer webhook (`PORTAINER_WEBHOOK_URL`) with `CSK_HUB_IMAGE` set to that image. The webhook
  URL is a deployment credential, configured separately from registry access.
- Without `--deploy`, select the release in Portainer by setting `CSK_HUB_IMAGE` and redeploying.
  Either way, `migrate` runs before the new app starts.

A manually triggered release workflow that calls `publish-image.sh --deploy` is planned but not
added yet; pushing to `master` runs CI only.

## Maintenance commands

The image ships the maintenance CLI. Run it in the api container's console in Portainer
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
| The image, its contents and its CPU target | The host, Docker and Portainer |
| `compose.yml`, `stack.env` values and secrets | The reverse proxy, TLS and the public hostname |
| Publishing and choosing releases | Registry pull access from the host |
| Migrations and maintenance commands | Host-level monitoring and updates |
| Application data correctness | To be agreed: backups and recovery (below) |

Portainer reads `deploy/compose.yml` by its repository-relative path. Confirm on GUD's setup at
production rollout, together with the CPU architecture and the webhook's `CSK_HUB_IMAGE`
override.

## Backups

The `postgres_data` volume persists data across restarts and redeploys. **It is not a backup**:
it lives on the same host, and deleting the stack's volumes, host failure or a bad migration
loses it. Backup and restore are not implemented here. Who backs up what, and how recovery
works, must be agreed with GUD, who may already provide it, before real data is stored.

---
status: proposed
---

# Packaging lives in `deploy/`, and production operations ship in the image

How the Hub is packaged and hosted lives in `deploy/`: the Dockerfile, the Compose files,
`stack.env.example`, the publish and deploy scripts and their README. We use `deploy/` rather
than `infrastructure/` because Bookie already does and the Hono migration (#1) follows Bookie's
conventions, so only one repository has to agree with the other.

Everything else keeps the home of what it is:

- Commands that run in production (`migrate`, `org bootstrap`, `admin bootstrap` and
  `admin recover`) are application code in the API (`apps/api/src/cli`) and ship in the API
  image. They use the deployed
  environment's own database and email configuration. None is chosen by a target flag.
- Local reset, Studio and seeds are a dev-only CLI (`apps/api/scripts/dev`). It refuses any database that is not local and is never in the image.
- The default org structure belongs to the org-structure feature and is created once by an
  explicit bootstrap, never on deploy.
- Schema migrations live in `apps/api/drizzle/`; workflows stay in `.github/workflows/`; `.dockerignore`
  stays at the repository root while that is the build context.

The API image serves both `migrate` and `api`: `migrate` applies pending migrations with
drizzle-orm's migrator and exits; `api` starts only after it succeeds. Since the web cutover (#7)
the web app ships as its own image, a static Caddy server that also routes API paths to `api`
(see [ADR 0013](0013-bun-workspace-with-independent-api-and-web-apps.md)). drizzle-orm's migrator is
the only runner (dev CLI, image and test databases); drizzle-kit is kept for `generate`, `check`
and Studio.

## Consequences

- Production can no longer be reached from a laptop with `--prod`. Maintenance runs in the app
  container's console, so it can only touch the database that container is configured for.
- Deploys never write default data. Group *types* (a schema enum) are the only system data
  found so far; anything later found to be mandatory gets a versioned data migration and rules
  protecting its invariants, not a "create what is missing" step.
- A persistent volume is not a backup. Backup and recovery responsibilities are agreed with GUD
  separately, before real data is stored.

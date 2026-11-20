# Dev database CLI

`bun run db` manages the **local development database only**: migrations, Studio, reset and the
demo seeds. It reads `POSTGRES_URL` and refuses anything that is not a database on this machine.
There is no production target. Production maintenance runs inside the deployed environment with
the release image's own commands; see [`deploy/README.md`](../../deploy/README.md).

This directory moves to `apps/api/scripts/dev` when the API workspace exists. It is never part of
the release image.

```bash
docker compose -f deploy/compose.dev.yml up -d   # local PostgreSQL and Redis

bun run db                   # migration status, then an interactive menu
bun run db status            # applied and pending migrations
bun run db migrate           # apply pending migrations (drizzle-orm's migrator)
bun run db studio            # Drizzle Studio
bun run db reset             # erase, migrate and create the default org structure; --yes skips the question
bun run db org-bootstrap     # the default org structure, only on a database that has none
bun run db seed-users        # 100 verified example accounts, three of them Admins
bun run db seed-groups       # balanced placements, groups, Positions and their history
bun run db seed-posts        # 24 published example Posts, after seed-users
bun run db seed-events       # example Events, Locations and a gig group, after seed-groups
bun run db seed-demo         # the default org structure and all of the above, after migrating
```

`db:generate` (drizzle-kit) and `auth:generate` stay separate package scripts because they work
offline.

## Guardrails

- Every command first checks `POSTGRES_URL` and exits non-zero, naming the host but not the
  credentials, unless it points at `localhost`, `127.0.0.1` or `[::1]`. The CLI is the only
  entrypoint: the seeds are functions it calls in-process with a client it created, so there is
  no script to run around the check.
- `reset` asks before erasing; without a terminal it refuses unless given `--yes`. It drops the
  `public` and `drizzle` schemas, runs every migration and creates the default org structure,
  but seeds no people.
- `org-bootstrap` uses the org-structure feature's own commands and does nothing once any group
  or Position exists.

## Layout

```text
index.ts             the CLI
local-database.ts    the local-only check every command starts with
migration-status.ts  the ledger comparison behind `status`
reset.ts             reset
seeds/               every seed and its helpers (data.ts, group-activity.ts)
test-support.ts      runs the CLI from tests
```

## Local demo data

After `bun run db migrate`, run `bun run db seed-demo`. It creates the default org structure if
the database has none, then seeds people, placements, group history, Posts and Events in one
transaction. It never resets the database. The individual seed commands remain available; run
`org-bootstrap`, `seed-users`, `seed-groups`, `seed-posts`, then `seed-events` for the same dataset.

On an empty database the demo contains:

- 100 distinct named, email-verified Users, with usernames `singer001` through `singer100`.
  Sign in as `singer-001@example.com` through `singer-100@example.com`, all with password
  `password`; the first three Users are Admins. New accounts share one salted credential hash per seed run.
- 34/33/33 singers across DK, KK and MK, with 8–9 singers per Section. KK alternates
  divisions within its S/A/T/B Sections. Existing unplaced active Users are placed too;
  the seed balances around existing placements rather than moving anyone.
- Varied Choir join dates from 2021–2025, Section and division changes, independent
  self-reported Voice capabilities, and some Users who have declared none.
- CSK-wide and Choir-owned committees, gig groups, roddgrupper, festgrupper and rephelgsgrupper,
  with helpers, former members, rejoins and Position handovers. Six additional groups are
  archived, including an old Board and completed concert/rephelg projects.
- Choir Dirigenter, Notfiskaler, Konsertmästare and Gigmästare; a Stämförälder for each
  Section; a current Board with one elected Position per member. Board offices are linked
  to their responsibility groups, and each Choir's Gigmästare also serves in the Gigmästeri,
  respecting the Position catalogue's Group limits. Some singers hold multiple non-Board Positions.
- 24 fictional Swedish Posts with paragraphs, headings, lists, emphasis and blockquotes,
  published by the example Admins between August 2025 and October 2026. They use the editor's
  document format and appear in the shared News feed. Their event details are demo content.
- Example Events from the coming Monday on. Each Choir has a weekly rehearsal series on its own
  weekday, a sectional (KKB, MKT1, DKS1), a Draft julkonsert and a Cancelled extra rehearsal.
  For all of CSK: the Alumnikväll gig with its gig group and Event details, the Höstsittning,
  the Januarimöte Körmöte for everyone and a room Booking, at the Locations Scania and Kårhuset.

Stable identities make these seeds repeatable: they insert missing fixtures and keep existing
passwords, profile edits and Post edits. A conflicting existing Position assignment fails the
demo transaction rather than displacing its holder. To return to the original demo after editing
it, deliberately run `bun run db reset`, then `bun run db seed-demo`.

Seed accounts are created one way: `seed-users` writes Better Auth's tables with its password
hash, because the demo needs known passwords and verified emails without sending invitations.
Real Admins are created with `bun cli.js admin bootstrap` (see `deploy/README.md`).

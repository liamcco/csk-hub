# Migrations

Schema and data migrations, one timestamped folder each with `migration.sql` and a v9
`snapshot.json` (drizzle-kit v1 layout, no shared journal). Generate a named one with
`bun run db:generate --name=kebab-name`; never edit an applied `migration.sql`, since the ledger
matches legacy rows by its hash.

drizzle-orm's migrator (`src/core/db/migrate.ts`) is the only runner: `bun run db migrate`
locally, `bun cli.js migrate` in the release image, and the disposable test databases.
drizzle-kit is used only for `generate`, `check` and Studio.

## Drizzle v1 migration history

Both Drizzle packages are pinned to `1.0.0-rc.5`. The 18 SQL files that predate v1 were
preserved byte for byte during conversion, including the hand-written domains, triggers and
`NULLS NOT DISTINCT` index.

Better Auth uses its `relations-v2` adapter and the matching `auth` CLI. Running
`bun run auth:generate` emits `defineRelationsPart` definitions for Drizzle v1.

The conversion repaired three metadata issues:

- The data-only `member-role-to-user` migration had no snapshot. Its snapshot repeats
  the preceding schema with its own ID, and the following snapshot points to it.
- `post-body-to-document` and `post-body-search` originally shared a second. Their
  folder timestamps were moved to the next two seconds to retain dependency order.
  Both moved out of the original second so v1 backfills their ledger names by SQL
  hash, rather than assigning both rows to the same timestamp match.
- Check and partial-index expressions were normalized by removing their own table
  qualifier before conversion. This avoids the converter's [false schema changes](https://github.com/drizzle-team/drizzle-orm/issues/6020)
  and an index rebuild that would lose the hand-written `NULLS NOT DISTINCT` behavior.

`bunx drizzle-kit check` and `bun run db:generate` should report no schema changes.

The first v1 migration run upgrades the database ledger, adding `name` and `applied_at` and
backfilling existing migration names. `bun run db status` reads both ledger versions without
writing to either: v1 uses folder names, while a legacy ledger is matched by SQL hash.

Some early migration comments mention `bun run ops reference-data`; that command is now
`org bootstrap` (see `deploy/README.md`). The comments stay as written because changing a
`migration.sql` changes its hash.

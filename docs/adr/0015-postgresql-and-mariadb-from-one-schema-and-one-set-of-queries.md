---
status: proposed
---

# PostgreSQL and MariaDB from one set of feature queries

CSK Hub runs on PostgreSQL or MariaDB (11.4 or later), chosen by the scheme of `DATABASE_URL`
(`postgresql://` or `mariadb://`). Hosts the choir can use offer MariaDB but not PostgreSQL.

Each table is defined twice, in `src/core/db/schema/postgres` and `src/core/db/schema/mariadb`,
with the same columns, keys and constraint names, and each dialect has its own migrations
(`drizzle/`, `drizzle-mariadb/`). Feature code is written once: it imports the selector modules in
`src/core/db/schema`, which hand it the tables of the process's dialect typed as PostgreSQL's, and
the MariaDB client (`src/core/db/mariadb`) gives Drizzle's MySQL builders the PostgreSQL methods
the features use, and the SQL semantics they expect: UTC, READ COMMITTED, null ordering,
`SET` evaluated against the old row, constraint names on errors. Raw SQL goes through
`src/core/db/sql.ts`. The test suite runs on both databases in CI.

We chose this over a repository layer with one implementation per database, which would double
every query, and over Drizzle alone, which has no dialect-neutral builder.

## Consequences

- A schema change is made in both schema folders, with a migration for each.
- Types are checked against PostgreSQL only. A query that type-checks may still use something
  MariaDB lacks, such as lateral joins, `distinct on` or PostgreSQL functions in raw SQL; the
  MariaDB test run is what catches it, and `compat.ts` throws rather than guessing.
- Features that need behaviour MariaDB lacks are written differently on both databases, not
  emulated: the inbox uses correlated subqueries, and the delivery worker locks then updates.
- What PostgreSQL enforces with partial indexes, domains and triggers, MariaDB enforces with
  generated columns, CHECK constraints and triggers that raise the same constraint names.
- Drizzle's relational queries (and Better Auth's `joins`) need LATERAL, so they stay off.
- The compatibility layer patches Drizzle's MySQL builders, which are pinned to 1.0.0-rc.5;
  upgrading Drizzle means re-running both test suites before anything else.
- Some behaviour still differs: text sort order, timestamp precision, the rights the database
  user needs, and the advisory-lock table. [`src/core/db/README.md`](../../apps/api/src/core/db/README.md#limitations-on-mariadb)
  lists them.

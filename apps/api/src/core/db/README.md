# Database

The application's database client (`index.ts`), the client factory (`client.ts`), the migration
runner (`migrate.ts`), Drizzle schemas (`schema/`, see its README), portable SQL (`sql.ts`), the
MariaDB adapter (`mariadb/`) and the TLS policy (`tls.ts`).

## The application contract

The application consumes one variable: `DATABASE_URL` (or `POSTGRES_URL`, which existing
deployments set). Locally it comes from `.env` and points at the dev Compose container; in the
deployed stack it comes from `deploy/compose.yml`. Application code never chooses between
environments.

## PostgreSQL or MariaDB

The URL's scheme picks the database: `postgresql://` or `mariadb://` (`dialect.ts`). The choice is
made once per process, when the schemas load. Feature code is the same on both: it is typed
against the PostgreSQL schema, and on MariaDB `mariadb/compat.ts` and the dialect in
`mariadb/client.ts` supply what the features rely on from PostgreSQL. Raw SQL goes through
`sql.ts` (`now()`, intervals, JSON fields, `ilike`, advisory locks), never PostgreSQL syntax
directly. MariaDB 11.4 or later is required.

`index.ts` reads the URL at import and is the application's client. Everything that must
choose its own database — the dev CLI, the test harness and the release image's commands —
calls `createDb(url)` from `client.ts` instead, so nothing needs a subprocess or a modified
environment to reach another database. `migrateDatabase` in `migrate.ts` is the one migration
runner (drizzle-orm's migrator); see [`drizzle/README.md`](../../../drizzle/README.md).

## Verified TLS

`tls.ts` answers one question: how is a connection string dialled securely? A local database
(`localhost`, `127.0.0.1`, `[::1]`) is dialled in plain text. Every other PostgreSQL connection is
verified against the Supabase root CA, and every other MariaDB connection against the system trust
store, with `rejectUnauthorized: true`, unless its own URL says
`sslmode=disable`. The deployed stack uses that for its database on the private Compose network
(`db:5432`), where there is no certificate to verify; the choice is visible wherever the URL is
configured, and there is no other switch.

Any other `sslmode` in the connection string is removed before connecting, because `pg` lets
it override explicit `ssl` options, which would silently discard the CA.

### The committed CA

`certs/supabase-root-2021.ts` holds Supabase's root certificate. Supabase signs its
database certificates with this root rather than a public CA, so no system trust store
contains it. It is public trust material, identical for every Supabase project, and is
committed rather than kept in `.env`.

It is a TypeScript module rather than a `.crt` file so that nothing reads the filesystem
at runtime. It travels with the import graph into the API bundle and into
drizzle-kit's bundled config, with no file-tracing configuration.

- Provenance: downloaded from the Supabase dashboard (Database settings → SSL
  Configuration).
- Subject: `CN=Supabase Root 2021 CA, O=Supabase Inc`.
- Expires: 26 April 2031. Replace it before then.

## Direct versus pooled connections

Supabase exposes a transaction pooler on port 6543 and a direct connection on port 5432.
Migrations cannot run through the transaction pooler, so any database that is migrated must be
reached through a direct connection.

## Limitations on MariaDB

What differs on MariaDB, beyond the schema spellings in [`schema/README.md`](schema/README.md).
The design behind it is [ADR 0015](../../../../../docs/adr/0015-postgresql-and-mariadb-from-one-schema-and-one-set-of-queries.md).

### Rights the database user needs

- **Tests** create and drop a `csk_hub_test_*` database beside the configured one for each suite
  (`test/database.ts`). Without the right to create them, the database tests are skipped.
- **The runtime user.** With `DATABASE_RUNTIME_URL` set, `migrate` creates that user and grants
  it data access (`runtime-role.ts`). On MariaDB that takes `CREATE USER` and `GRANT OPTION` on the
  application's database. `deploy/mariadb-dev-grants.sql` grants both, and the test rights, to the
  dev Compose user.
- **Shared hosting** (DirectAdmin, cPanel) usually allows neither. There the application
  connects as the one user the control panel creates, which also owns the schema: leave
  `DATABASE_RUNTIME_URL` unset. The tests are not run on such a host.

### Behaviour that differs

- **Text comparison.** The baseline migration sets `utf8mb4_uca1400_nopad_as_cs`, so equality
  and `like` are case- and accent-sensitive, and trailing spaces count, as on PostgreSQL.
  Case-insensitive search goes through `ilike` in `sql.ts`, which lowercases both sides; it is
  still accent-sensitive, as PostgreSQL's `ilike` is.
- **Sort order.** Text sorts by the Unicode root collation, where å, ä and ö sort with a and o
  rather than after z. PostgreSQL sorts by its database's collation, so a list ordered by name
  can come out in a different order on the two databases.
- **Timestamps** are `datetime(3)`: stored to the millisecond, where PostgreSQL keeps
  microseconds. The application only reads milliseconds, but a timestamp written by hand with
  more precision is truncated.
- **Lock timeouts** (`innodb_lock_wait_timeout`, `max_statement_time`) belong to the connection,
  not the transaction, and the lock timeout counts whole seconds. Only the tests set them
  (`withLockWaitLimit` in `test/database.ts`).
- **Advisory locks** are rows of `advisory_lock`, one per key, which are never deleted (see
  `lockKey` in `sql.ts`). Message sending locks on the author and idempotency key, so the table
  grows by one 64-byte row per sent Message. It needs no maintenance, but it can be emptied
  safely while the application is stopped.
- **Voice domains.** PostgreSQL's `voice_division` and `voice_family` domains are CHECK
  constraints with the same names on MariaDB. Values outside them are rejected by the same name,
  but there is no type to cast to, so the two tests of the domains' cast behaviour run on
  PostgreSQL only (`features/voice/capabilities.test.ts`).
- **No relational queries.** Drizzle's `db.query` and Better Auth's `joins` need LATERAL and
  stay off; feature code uses the query builder.

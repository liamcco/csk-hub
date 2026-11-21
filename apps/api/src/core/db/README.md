# Database

The application's database client (`index.ts`), the client factory (`client.ts`), the migration
runner (`migrate.ts`), Drizzle schemas (`schema/`) and the TLS policy (`tls.ts`).

## The application contract

The application consumes one variable: `POSTGRES_URL`. Locally it comes from `.env` and points
at the dev Compose container; in the deployed stack it comes from `deploy/compose.yml`.
Application code never chooses between environments.

`index.ts` reads `POSTGRES_URL` at import and is the application's client. Everything that must
choose its own database — the dev CLI, the test harness and the release image's commands —
calls `createDb(url)` from `client.ts` instead, so nothing needs a subprocess or a modified
environment to reach another database. `migrateDatabase` in `migrate.ts` is the one migration
runner (drizzle-orm's migrator); see [`drizzle/README.md`](../../../drizzle/README.md).

## Verified TLS

`tls.ts` answers one question: how is a connection string dialled securely? A local database
(`localhost`, `127.0.0.1`, `[::1]`) is dialled in plain text. Every other connection is verified
against the Supabase root CA with `rejectUnauthorized: true`, unless its own URL says
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

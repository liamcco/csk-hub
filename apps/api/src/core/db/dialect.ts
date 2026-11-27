/**
 * Which database family the application runs on. CSK Hub runs on PostgreSQL or MariaDB; the
 * connection string's scheme decides which, so there is no separate switch to keep in step with it.
 *
 * Relative imports only, never `@/`: drizzle-kit bundles the Drizzle configs without reading
 * tsconfig paths, and this module is on that import path.
 */

export type DatabaseDialect = "postgresql" | "mariadb"

const SCHEMES: Record<string, DatabaseDialect> = {
  "postgres:": "postgresql",
  "postgresql:": "postgresql",
  "mariadb:": "mariadb",
  "mysql:": "mariadb"
}

/** Thrown for a connection string whose scheme names no supported database. */
export class UnsupportedDatabaseError extends Error {
  override name = "UnsupportedDatabaseError"
}

/**
 * The dialect a connection string names: `postgres://` or `postgresql://` for PostgreSQL,
 * `mariadb://` or `mysql://` for MariaDB. Throws `UnsupportedDatabaseError` for anything else.
 */
export function dialectOf(url: string): DatabaseDialect {
  const dialect = SCHEMES[new URL(url).protocol]
  if (!dialect) throw new UnsupportedDatabaseError(`Unsupported database URL scheme: ${new URL(url).protocol}`)
  return dialect
}

/**
 * The application database's connection string: `DATABASE_URL`, or `POSTGRES_URL`, which existing
 * deployments set. Undefined when neither is set, as in builds and contract exports.
 */
export function configuredDatabaseUrl(environment: Record<string, string | undefined> = process.env) {
  return environment.DATABASE_URL || environment.POSTGRES_URL || undefined
}

/**
 * The dialect of this process, fixed when it starts. Schemas and portable SQL read it at import,
 * so one process never mixes dialects. Without a configured URL it is PostgreSQL.
 */
export const databaseDialect: DatabaseDialect = (() => {
  const url = configuredDatabaseUrl()
  return url ? dialectOf(url) : "postgresql"
})()

/** Whether this process runs on MariaDB. */
export const isMariaDb = databaseDialect === "mariadb"

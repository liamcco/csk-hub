import { fileURLToPath } from "node:url"
import { readMigrationFiles } from "drizzle-orm/migrator"
import { createConnection } from "mysql2/promise"
import { Client } from "pg"
import { isMariaDb } from "@/core/db/dialect"
import { mariaDbPoolOptions } from "@/core/db/mariadb/client"
import { migrationsFolderName } from "@/core/db/migrate"
import { secureConnection } from "@/core/db/tls"
import type { LocalDatabase } from "./local-database"

/**
 * Compares the migration files on disk against the ledger a database has actually
 * applied. This is a *ledger* comparison, not a schema diff: it answers "is this database
 * behind the code?" and deliberately does not detect a column altered by hand.
 */

export type MigrationStatus =
  | { kind: "unreachable"; host: string; reason: string }
  | { kind: "ok"; host: string; applied: string[]; pending: string[] }

export const MIGRATIONS_FOLDER = fileURLToPath(new URL(`../../${migrationsFolderName}`, import.meta.url))

/** Read the ordered local migrations using the same parser and SQL hashes as Drizzle. */
export function readMigrations() {
  return readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER })
}

/**
 * The ledger status of the local database.
 *
 * Connecting and the ledger query are each bounded by `timeout` milliseconds, so a database
 * that stops answering, or a lock held on the ledger, reports `unreachable` rather than
 * hanging. Ending the client while the timed-out query is still active destroys the socket.
 */
export async function statusOf(
  database: LocalDatabase,
  { timeout = 10_000 }: { timeout?: number } = {}
): Promise<MigrationStatus> {
  const { host } = database
  const entries = readMigrations()
  const ledger = isMariaDb ? mariaDbLedger(database.url, timeout) : postgresLedger(database.url, timeout)

  try {
    const rows = await ledger.read()
    const appliedNames = new Set(rows.flatMap((row) => (row.name === null ? [] : [row.name])))
    const legacyHashes = new Set(rows.filter((row) => row.name === null).map((row) => row.hash))
    const applied = entries.filter((entry) => appliedNames.has(entry.name) || legacyHashes.has(entry.hash))
    const appliedSet = new Set(applied)

    return {
      kind: "ok",
      host,
      applied: applied.map((entry) => entry.name),
      pending: entries.filter((entry) => !appliedSet.has(entry)).map((entry) => entry.name)
    }
  } catch (error) {
    // An absent ledger means the database exists but has never been migrated, which is a
    // normal state for a fresh checkout rather than a failure to report.
    if (isMissingLedger(error)) {
      return { kind: "ok", host, applied: [], pending: entries.map((entry) => entry.name) }
    }

    return { kind: "unreachable", host, reason: describeError(error) }
  } finally {
    await ledger.close().catch(() => {})
  }
}

type LedgerRow = { name: string | null; hash: string }

/** PostgreSQL's ledger, `drizzle.__drizzle_migrations`. */
function postgresLedger(url: string, timeout: number) {
  const client = new Client({ ...secureConnection(url), connectionTimeoutMillis: timeout, query_timeout: timeout })
  return {
    async read() {
      await client.connect()
      const { rows } = await client.query<LedgerRow>(
        // Reading the row as JSON also works before v1's migrator adds the name column.
        `select to_jsonb(m)->>'name' as name, hash from drizzle.__drizzle_migrations m`
      )
      return rows
    },
    close: () => client.end()
  }
}

/** MariaDB's ledger, `__drizzle_migrations` in the application's own database; it has always had names. */
function mariaDbLedger(url: string, timeout: number) {
  const connecting = createConnection({ ...mariaDbPoolOptions(secureConnection(url)), connectTimeout: timeout })
  return {
    async read() {
      const connection = await connecting
      const [rows] = await connection.query({ sql: "select name, hash from __drizzle_migrations", timeout })
      return rows as LedgerRow[]
    },
    close: async () => (await connecting).end()
  }
}

/**
 * A refused connection arrives as an AggregateError whose own message is empty, so the
 * useful text has to be dug out of the causes — otherwise the status screen reports a
 * failure with no reason attached.
 */
function describeError(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length > 0) {
    return [...new Set(error.errors.map(describeError))].join("; ")
  }

  const { message, code } = (error ?? {}) as { message?: string; code?: string }
  return message || code || String(error)
}

/** PostgreSQL 3F000 (undefined schema) and 42P01 (undefined table); MariaDB 1146 (no such table). */
function isMissingLedger(error: unknown): boolean {
  const { code, errno } = (error ?? {}) as { code?: string; errno?: number }
  return code === "3F000" || code === "42P01" || errno === 1146
}

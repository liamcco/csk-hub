import { fileURLToPath } from "node:url"
import { type SQL, sql } from "drizzle-orm"
import { createConnection } from "mysql2/promise"
import { Client } from "pg"
import type { db as applicationDb, Database } from "@/core/db"
import { createDb } from "@/core/db/client"
import { configuredDatabaseUrl, isMariaDb } from "@/core/db/dialect"
import { mariaDbPoolOptions } from "@/core/db/mariadb/client"
import { migrateDatabase, migrationsFolderName } from "@/core/db/migrate"
import { isLocalDatabase, secureConnection } from "@/core/db/tls"

export type TestDatabase = {
  /** Typed as the application client, so modules that take one accept it. */
  db: typeof applicationDb
  /** The connection string, for code that connects on its own, such as the dev CLI. */
  url: string
  /** Closes the connections and drops the database. */
  drop: () => Promise<void>
}

/** Creating and dropping a database beside the local one, for each dialect. */
type Server = {
  create: (name: string) => Promise<void>
  drop: (name: string) => Promise<void>
}

function postgresServer(baseUrl: string): Server {
  return {
    async create(name) {
      const admin = new Client({ connectionString: baseUrl, connectionTimeoutMillis: 2_000 })
      try {
        await admin.connect()
        await admin.query(`CREATE DATABASE "${name}"`)
      } finally {
        await admin.end().catch(() => undefined)
      }
    },
    async drop(name) {
      const cleanup = new Client({ connectionString: baseUrl })
      await cleanup.connect()
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      } catch (error) {
        // FORCE may not terminate an autovacuum worker on the new database without
        // pg_signal_backend; a plain drop asks autovacuum to stop and waits for it instead.
        if ((error as { code?: string }).code !== "42501") throw error
        await cleanup.query(`DROP DATABASE IF EXISTS "${name}"`)
      } finally {
        await cleanup.end()
      }
    }
  }
}

function mariaDbServer(baseUrl: string): Server {
  const connect = () => createConnection({ ...mariaDbPoolOptions(secureConnection(baseUrl)), connectTimeout: 2_000 })
  return {
    async create(name) {
      const admin = await connect()
      try {
        // The collation the baseline migration sets, so text compares as it will in production.
        await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_nopad_as_cs`)
      } finally {
        await admin.end().catch(() => undefined)
      }
    },
    async drop(name) {
      const cleanup = await connect()
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS \`${name}\``)
      } finally {
        await cleanup.end()
      }
    }
  }
}

/**
 * A throwaway database, migrated from scratch, beside the local one in DATABASE_URL (or
 * POSTGRES_URL). Tests that need real constraints use it so they never touch development data.
 * On MariaDB the configured user needs the right to create `csk_hub_test_*` databases, which the
 * dev Compose stack grants.
 *
 * Returns undefined when no local database is reachable; callers skip rather than fail, so the
 * suite still runs on a machine without a database. It never creates a database anywhere but locally.
 * With `migrationsFolder` null the database is left empty, for tests of migrating itself.
 */
export async function createTestDatabase(
  migrationsFolder: string | null = fileURLToPath(new URL(`../${migrationsFolderName}`, import.meta.url))
): Promise<TestDatabase | undefined> {
  const baseUrl = configuredDatabaseUrl()
  if (!baseUrl || !isLocalDatabase(baseUrl)) return undefined

  const name = `csk_hub_test_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`
  const server = isMariaDb ? mariaDbServer(baseUrl) : postgresServer(baseUrl)
  try {
    await server.create(name)
  } catch (error) {
    console.warn(`Skipping database tests: no local database is reachable (${(error as Error).message}).`)
    return undefined
  }

  const url = new URL(baseUrl)
  url.pathname = `/${name}`
  const db = createDb(url.toString())
  if (migrationsFolder !== null) await migrateDatabase(db, { migrationsFolder })

  return {
    db,
    url: url.toString(),
    drop: async () => {
      await db.$client.end()
      await server.drop(name)
    }
  }
}

/**
 * Runs `work` in `tx` giving up on any row lock it waits for after about `lockWaitMs`, and on any
 * statement after `statementMs` if given, so a test can show that one transaction blocks another.
 * PostgreSQL scopes the limits to the transaction. MariaDB's are per connection and count whole
 * seconds, so they are rounded up and restored afterwards: a lock timeout there fails only the
 * statement, so the transaction can still restore them.
 */
export async function withLockWaitLimit<T>(
  tx: Database,
  { lockWaitMs, statementMs }: { lockWaitMs: number; statementMs?: number },
  work: () => Promise<T>
): Promise<T> {
  if (!isMariaDb) {
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${lockWaitMs}ms'`))
    if (statementMs) await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${statementMs}ms'`))
    return work()
  }
  const restore: SQL[] = [sql`SET SESSION innodb_lock_wait_timeout = DEFAULT`]
  await tx.execute(sql.raw(`SET SESSION innodb_lock_wait_timeout = ${Math.max(1, Math.ceil(lockWaitMs / 1000))}`))
  if (statementMs) {
    await tx.execute(sql.raw(`SET SESSION max_statement_time = ${statementMs / 1000}`))
    restore.push(sql`SET SESSION max_statement_time = DEFAULT`)
  }
  try {
    return await work()
  } finally {
    for (const statement of restore) await tx.execute(statement)
  }
}

/** What a driver error looks like when a lock wait timed out under `withLockWaitLimit`. */
export const LOCK_WAIT_TIMEOUT = isMariaDb ? { errno: 1205 } : { code: "55P03" }

/** What a driver error looks like when a unique constraint rejected a row. */
export const UNIQUE_VIOLATION = isMariaDb ? { errno: 1062 } : { code: "23505" }

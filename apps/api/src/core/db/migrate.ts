import type { MySql2Database } from "drizzle-orm/mysql2"
import { migrate as migrateMariaDb } from "drizzle-orm/mysql2/migrator"
import { migrate as migratePostgres } from "drizzle-orm/node-postgres/migrator"
import type { Db } from "./client"
import { type DatabaseDialect, databaseDialect } from "./dialect"

/**
 * The name of each dialect's migrations folder: `drizzle/` for PostgreSQL and `drizzle-mariadb/`
 * for MariaDB. Both sit beside `src` in the API workspace and beside `cli.js` in the release image;
 * callers resolve the name against where they run.
 */
export const MIGRATIONS_FOLDER_NAMES: Record<DatabaseDialect, string> = {
  postgresql: "drizzle",
  mariadb: "drizzle-mariadb"
}

/** This process's migrations folder name; see `MIGRATIONS_FOLDER_NAMES`. */
export const migrationsFolderName = MIGRATIONS_FOLDER_NAMES[databaseDialect]

/**
 * Apply every pending migration in `migrationsFolder` with drizzle-orm's migrator for the
 * process's dialect.
 *
 * The one migration runner: the dev CLI, the release image's `migrate` command and the disposable
 * test databases all call it, so a migration that passes the tests applies the same way everywhere.
 * drizzle-kit is kept for `generate`, `check` and Studio only.
 */
export async function migrateDatabase(database: Db, { migrationsFolder }: { migrationsFolder: string }) {
  if (databaseDialect === "mariadb") {
    await migrateMariaDb(database as unknown as MySql2Database, { migrationsFolder })
    return
  }
  await migratePostgres(database, { migrationsFolder })
}

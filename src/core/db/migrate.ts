import { migrate } from "drizzle-orm/node-postgres/migrator"
import type { Db } from "./client"

/**
 * Apply every pending migration in `migrationsFolder` with drizzle-orm's migrator.
 *
 * The one migration runner: the dev CLI, the release image's `migrate` command and the disposable
 * test databases all call it, so a migration that passes the tests applies the same way everywhere.
 * drizzle-kit is kept for `generate`, `check` and Studio only.
 */
export async function migrateDatabase(database: Db, { migrationsFolder }: { migrationsFolder: string }) {
  await migrate(database, { migrationsFolder })
}

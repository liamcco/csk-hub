import { confirm, isCancel } from "@clack/prompts"
import { sql } from "drizzle-orm"
import { createDb, type Db } from "@/core/db/client"
import { isMariaDb } from "@/core/db/dialect"
import { migrateDatabase } from "@/core/db/migrate"
import { executeRows } from "@/core/db/sql"
import { bootstrapOrgStructure } from "@/features/org-structure/defaults"
import { type LocalDatabase, requireLocalDatabase } from "./local-database"
import { MIGRATIONS_FOLDER } from "./migration-status"

/**
 * Empty the local database and build it again: drop every table, type, function and the
 * migration ledger (see `emptyDatabase`), run all migrations, then create the default org structure. Seeds are left to
 * the seed commands, so a reset never fabricates users on its own.
 *
 * Local-only by refusal: there is no circumstance in which "erase this deployed database?" should
 * be answerable with yes. Returns the exit code rather than exiting, so the interactive menu can
 * stay open.
 */
export async function resetLocalDatabase(
  database: LocalDatabase,
  { skipConfirmation }: { skipConfirmation: boolean }
): Promise<number> {
  const { url, host } = requireLocalDatabase(database.url)

  if (!(await confirmReset(host, { skip: skipConfirmation }))) return 1

  const client = createDb(url)
  try {
    await emptyDatabase(client)
    console.log(`Emptied ${host}.`)

    await migrateDatabase(client, { migrationsFolder: MIGRATIONS_FOLDER })
    await bootstrapOrgStructure(client)
  } finally {
    await client.$client.end().catch(() => {})
  }

  console.log("Migrated and created the default org structure. Seed it with: bun run db seed-demo")
  return 0
}

/**
 * Drops every table, type, function and procedure, and the migration ledger with them, so every
 * migration runs again. Dropping objects rather than the database needs no right to create one.
 */
async function emptyDatabase(client: Db) {
  if (!isMariaDb) {
    // The ledger is the "drizzle" schema; everything else is in "public".
    await client.execute(sql`DROP SCHEMA IF EXISTS "drizzle" CASCADE`)
    await client.execute(sql`DROP SCHEMA IF EXISTS "public" CASCADE`)
    await client.execute(sql`CREATE SCHEMA "public"`)
    return
  }
  // One connection, so foreign-key checks stay off for every drop; triggers go with their tables.
  await client.transaction(async (tx) => {
    const tables = await executeRows<{ name: string }>(
      tx,
      sql`select table_name as name from information_schema.tables where table_schema = database()`
    )
    const procedures = await executeRows<{ name: string }>(
      tx,
      sql`select routine_name as name from information_schema.routines where routine_schema = database()`
    )
    await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 0`)
    for (const { name } of tables) await tx.execute(sql`DROP TABLE IF EXISTS ${sql.identifier(name)}`)
    for (const { name } of procedures) await tx.execute(sql`DROP PROCEDURE IF EXISTS ${sql.identifier(name)}`)
    await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 1`)
  })
}

/** Ask before erasing, since local data may be worth keeping. Without a terminal, refuse. */
async function confirmReset(host: string, { skip }: { skip: boolean }): Promise<boolean> {
  if (skip) return true

  if (!process.stdin.isTTY) {
    console.error(`✖ Resetting ${host} needs confirmation, but there is no terminal to ask.`)
    console.error("  Pass --yes to proceed unattended.")
    return false
  }

  const answer = await confirm({
    message: `Erase everything in ${host} and migrate it from scratch?`,
    initialValue: false
  })
  if (isCancel(answer) || !answer) {
    console.error("Aborted.")
    return false
  }
  return true
}

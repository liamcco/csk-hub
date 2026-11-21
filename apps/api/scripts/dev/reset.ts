import { confirm, isCancel } from "@clack/prompts"
import { sql } from "drizzle-orm"
import { createDb } from "@/core/db/client"
import { migrateDatabase } from "@/core/db/migrate"
import { bootstrapOrgStructure } from "@/features/org-structure/defaults"
import { type LocalDatabase, requireLocalDatabase } from "./local-database"
import { MIGRATIONS_FOLDER } from "./migration-status"

/**
 * Empty the local database and build it again: drop every table, type, function and the
 * migration ledger, run all migrations, then create the default org structure. Seeds are left to
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
    // Dropping the schemas rather than the database needs no CREATEDB privilege, and takes the
    // migration ledger (schema "drizzle") with it so every migration runs again.
    await client.execute(sql`DROP SCHEMA IF EXISTS "drizzle" CASCADE`)
    await client.execute(sql`DROP SCHEMA IF EXISTS "public" CASCADE`)
    await client.execute(sql`CREATE SCHEMA "public"`)
    console.log(`Emptied ${host}.`)

    await migrateDatabase(client, { migrationsFolder: MIGRATIONS_FOLDER })
    await bootstrapOrgStructure(client)
  } finally {
    await client.$client.end().catch(() => {})
  }

  console.log("Migrated and created the default org structure. Seed it with: bun run db seed-demo")
  return 0
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

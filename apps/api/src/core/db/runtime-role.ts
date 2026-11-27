import { sql } from "drizzle-orm"
import { escapeId as escapeMariaDbIdentifier, escape as escapeMariaDbValue } from "mysql2"
import { escapeIdentifier, escapeLiteral } from "pg"
import type { Db } from "./client"
import { isMariaDb } from "./dialect"
import { executeRows } from "./sql"

/**
 * Create or update the database role the running application connects as, and give it data
 * access to the application schema only: it can read and write rows, but not create, alter or
 * drop anything, and it cannot see the migration ledger.
 *
 * The migration job calls this after migrating, as the schema owner, on every deploy. Granting on
 * every run covers tables added by the migrations just applied, and setting the password from
 * `runtimeUrl` makes rotation a configuration change. Returns the role's name.
 */
export async function provisionRuntimeRole(database: Db, runtimeUrl: string): Promise<string> {
  const url = new URL(runtimeUrl)
  const role = decodeURIComponent(url.username)
  const password = decodeURIComponent(url.password)
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error("The runtime role must be a lowercase SQL identifier.")
  if (!password) throw new Error("The runtime role needs a password in its connection string.")

  if (isMariaDb) {
    await provisionMariaDbUser(database, role, password)
    return role
  }

  const name = escapeIdentifier(role)
  await database.transaction(async (tx) => {
    const [current] = (await tx.execute<{ name: string }>(sql`select current_user as name`)).rows
    if (current?.name === role) throw new Error("The runtime role must differ from the role that runs migrations.")
    await tx.execute(
      sql.raw(`DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = ${escapeLiteral(role)}) THEN CREATE ROLE ${name}; END IF;
      END $$`)
    )
    await tx.execute(
      sql.raw(
        `ALTER ROLE ${name} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${escapeLiteral(password)}`
      )
    )
    await tx.execute(sql.raw(`GRANT USAGE ON SCHEMA public TO ${name}`))
    await tx.execute(sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${name}`))
    await tx.execute(sql.raw(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${name}`))
  })
  return role
}

/**
 * MariaDB's counterpart: a user that may log in from anywhere on the private network, with
 * SELECT, INSERT, UPDATE and DELETE on each application table. Grants are per table because the
 * migration ledger, `__drizzle_migrations`, shares the database; triggers run as the user who
 * created them, so the runtime user needs nothing on the procedures they call. The migrating user
 * needs CREATE USER and the GRANT OPTION.
 */
async function provisionMariaDbUser(database: Db, role: string, password: string) {
  const user = `${escapeMariaDbValue(role)}@'%'`
  const [current] = await executeRows<{ name: string }>(
    database,
    sql`select substring_index(current_user(), '@', 1) as name`
  )
  if (current?.name === role) throw new Error("The runtime role must differ from the role that runs migrations.")
  const tables = await executeRows<{ name: string }>(
    database,
    sql`select table_name as name from information_schema.tables
      where table_schema = database() and table_type = 'BASE TABLE' and table_name <> '__drizzle_migrations'`
  )
  await database.execute(sql.raw(`CREATE USER IF NOT EXISTS ${user} IDENTIFIED BY ${escapeMariaDbValue(password)}`))
  await database.execute(sql.raw(`ALTER USER ${user} IDENTIFIED BY ${escapeMariaDbValue(password)}`))
  for (const { name } of tables) {
    await database.execute(
      sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${escapeMariaDbIdentifier(name)} TO ${user}`)
    )
  }
}

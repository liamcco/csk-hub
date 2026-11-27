import { afterAll, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { isMariaDb } from "@/core/db/dialect"
import { user } from "@/core/db/schema/auth"
import { group } from "@/core/db/schema/org-structure"
import { executeRows } from "@/core/db/sql"
import { createTestDatabase } from "../../test/database"
import { NotLocalDatabaseError } from "./local-database"
import { readMigrations } from "./migration-status"
import { resetLocalDatabase } from "./reset"

const database = await createTestDatabase()

describe.skipIf(!database)("resetLocalDatabase", () => {
  const t = database as NonNullable<typeof database>
  afterAll(() => t.drop())

  test("refuses any database that is not local", async () => {
    await t.db.insert(user).values({ id: "kept", name: "Kept", email: "kept@example.com" })

    await expect(
      resetLocalDatabase(
        { url: "postgresql://someone@db.example.com:5432/csk_hub", host: "remote" },
        { skipConfirmation: true }
      )
    ).rejects.toThrow(NotLocalDatabaseError)
    expect(await t.db.select().from(user)).toHaveLength(1)
  })

  test("empties the database, runs every migration and creates the default org structure", async () => {
    expect(await resetLocalDatabase({ url: t.url, host: "test" }, { skipConfirmation: true })).toBe(0)

    expect(await t.db.select().from(user)).toEqual([])
    const ledger = sql.raw(isMariaDb ? "`__drizzle_migrations`" : "drizzle.__drizzle_migrations")
    const [applied] = await executeRows<{ count: number }>(t.db, sql`select count(*) as count from ${ledger}`)
    expect(Number(applied?.count)).toBe(readMigrations().length)
    expect((await t.db.select({ name: group.name }).from(group)).map(({ name }) => name)).toContain("KKB")
  }, 60_000)
})

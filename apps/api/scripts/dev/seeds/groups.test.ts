import { afterAll, describe, expect, test } from "bun:test"
import { and, eq, isNull } from "drizzle-orm"
import { user } from "@/core/db/schema/auth"
import { group, groupMember } from "@/core/db/schema/org-structure"
import { bootstrapOrgStructure } from "@/features/org-structure/defaults"
import { createTestDatabase } from "../../../test/database"
import { seedGroups } from "./groups"

const database = await createTestDatabase()

describe.skipIf(!database)("seedGroups", () => {
  if (!database) return
  const t = database as NonNullable<typeof database>
  afterAll(() => t.drop())

  async function newUser() {
    const id = crypto.randomUUID()
    await t.db.insert(user).values({ id, name: "Singer", email: `${id}@example.com` })
    return id
  }

  test("refuses to run before the default org structure exists", async () => {
    await expect(seedGroups(t.db)).rejects.toThrow("bun run db org-bootstrap")
  })

  test("adds the example groups and places every unplaced user in a Choir and a Section, once", async () => {
    await bootstrapOrgStructure(t.db)
    const users = [await newUser(), await newUser()]

    const { created, placed } = await seedGroups(t.db)
    expect(created).toContain("Sexmästeri")
    expect(created).toContain("KK roddgrupp")
    expect(placed).toBe(2)

    for (const userId of users) {
      const rows = await t.db
        .select({ type: group.type, voice: groupMember.voice })
        .from(groupMember)
        .innerJoin(group, eq(group.id, groupMember.groupId))
        .where(and(eq(groupMember.userId, userId), isNull(groupMember.endDate)))
      expect(rows.map(({ type }) => type).sort()).toEqual(["Choir", "Section"])
      // Every seeded singer gets a division, even in a Section that sings a whole family.
      expect(rows.find(({ type }) => type === "Section")?.voice).toMatch(/^[SATB][12]$/)
    }

    expect(await seedGroups(t.db)).toEqual({ created: [], placed: 0 })
  })
})

import { afterAll, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { choir, group, groupTypePosition, position, positionGroup, section } from "@/core/db/schema/org-structure"
import { createTestDatabase } from "../../../../test/database"
import { archiveGroup, renameGroup } from "../structure"
import { bootstrapOrgStructure, DEFAULT_ORG_STRUCTURE } from "./bootstrap"

const database = await createTestDatabase()

describe.skipIf(!database)("org bootstrap", () => {
  if (!database) return
  afterAll(() => database.drop())
  const { db } = database

  test("creates the Choirs with their Sections and Voices, the CSK-wide groups and the Position catalogue", async () => {
    expect(await bootstrapOrgStructure(db)).toEqual({ created: true })

    const sections = await db
      .select({ name: group.name, voice: section.voice })
      .from(section)
      .innerJoin(group, eq(group.id, section.groupId))
    expect(sections.map(({ name, voice }) => `${name}:${voice}`).sort()).toEqual(
      [
        "MKT1:T1",
        "MKT2:T2",
        "MKB1:B1",
        "MKB2:B2",
        "DKS1:S1",
        "DKS2:S2",
        "DKA1:A1",
        "DKA2:A2",
        "KKS:S",
        "KKA:A",
        "KKT:T",
        "KKB:B"
      ].sort()
    )
    expect(await db.select().from(choir)).toHaveLength(3)
    const [board] = await db.select().from(group).where(eq(group.name, "Styret 25/26"))
    expect(board).toMatchObject({ type: "Board", choirId: null, active: true })

    const allowed = await db
      .select({ name: position.name, type: groupTypePosition.type })
      .from(groupTypePosition)
      .innerJoin(position, eq(position.id, groupTypePosition.positionId))
    expect(allowed.map(({ name, type }) => `${name}:${type}`)).toContain("Stämförälder:Section")
    expect(allowed).toHaveLength(
      DEFAULT_ORG_STRUCTURE.positions.reduce((total, { groupTypes }) => total + groupTypes.length, 0)
    )

    const limits = await db
      .select({ name: position.name, group: group.name })
      .from(positionGroup)
      .innerJoin(position, eq(position.id, positionGroup.positionId))
      .innerJoin(group, eq(group.id, positionGroup.groupId))
    expect(limits.map(({ name, group }) => `${name}:${group}`)).toContain("Gigmästare KK:KK")
    expect(limits.map(({ name, group }) => `${name}:${group}`)).toContain("Gigmästare KK:Gigmästeri")
  })

  test("is idempotent and does not recreate an archived or renamed default", async () => {
    const groupsBefore = await db.select().from(group)
    const [board] = groupsBefore.filter(({ name }) => name === "Styret 25/26")
    const [kk] = groupsBefore.filter(({ name }) => name === "KK")
    expect((await archiveGroup(db, board?.id as string)).success).toBe(true)
    expect((await renameGroup(db, kk?.id as string, "Kammarkören")).success).toBe(true)

    expect(await bootstrapOrgStructure(db)).toEqual({ created: false })

    const groupsAfter = await db.select().from(group)
    expect(groupsAfter).toHaveLength(groupsBefore.length)
    expect(groupsAfter.filter(({ name }) => name === "Styret 25/26")).toEqual([
      expect.objectContaining({ active: false })
    ])
    expect(groupsAfter.some(({ name }) => name === "KK")).toBe(false)
    expect(await db.select().from(position)).toHaveLength(DEFAULT_ORG_STRUCTURE.positions.length)
  })
})

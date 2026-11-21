import type { GroupType } from "@csk-hub/shared/features/org-structure/model"
import type { Voice } from "@csk-hub/shared/features/voice/model"
import { group, position } from "@/core/db/schema/org-structure"
import type { OrgStructureDatabase } from "../operation"
import { createChoir, createGroup, createPosition } from "../structure"

/**
 * The org structure a new environment starts with: the three Choirs with their four Sections and
 * the Voice each sings, the Board and the Gigmästeri, and the Position catalogue with the group
 * types each is allowed in. A Position may also be limited to some groups by name, as each Choir's
 * Gigmästare is to that Choir and the Gigmästeri.
 *
 * This is editable default data, not system data: Admins rename, archive and add to it, and no
 * code depends on any of these names. Only the group *types*, a schema enum, are system data.
 */
export const DEFAULT_ORG_STRUCTURE: {
  choirs: { name: string; sections: { name: string; voice: Voice }[] }[]
  groups: { name: string; type: Exclude<GroupType, "Choir" | "Section"> }[]
  positions: { name: string; groupTypes: GroupType[]; groups?: string[] }[]
} = {
  choirs: [
    {
      name: "MK",
      sections: [
        { name: "MKT1", voice: "T1" },
        { name: "MKT2", voice: "T2" },
        { name: "MKB1", voice: "B1" },
        { name: "MKB2", voice: "B2" }
      ]
    },
    {
      name: "DK",
      sections: [
        { name: "DKS1", voice: "S1" },
        { name: "DKS2", voice: "S2" },
        { name: "DKA1", voice: "A1" },
        { name: "DKA2", voice: "A2" }
      ]
    },
    {
      name: "KK",
      sections: [
        { name: "KKS", voice: "S" },
        { name: "KKA", voice: "A" },
        { name: "KKT", voice: "T" },
        { name: "KKB", voice: "B" }
      ]
    }
  ],
  groups: [
    { name: "Styret 25/26", type: "Board" },
    { name: "Gigmästeri", type: "Gigmästeri" }
  ],
  positions: [
    { name: "Ordförande", groupTypes: ["Board"] },
    { name: "Vice Ordförande", groupTypes: ["Board", "Rekryteringskommitté"] },
    { name: "Kassör", groupTypes: ["Board"] },
    { name: "Sekreterare", groupTypes: ["Board", "Föräldramötet"] },
    { name: "PR-mästare", groupTypes: ["Board"] },
    { name: "1:a Konsertmästare", groupTypes: ["Board", "Konsertmästeri"] },
    { name: "Gigmästare", groupTypes: ["Board", "Gigmästeri"] },
    { name: "Sexmästare", groupTypes: ["Board", "Sexmästeri"] },
    { name: "Sexmästarinna", groupTypes: ["Sexmästeri"] },
    { name: "Dirigent", groupTypes: ["Choir"] },
    { name: "Notfiskal", groupTypes: ["Choir"] },
    { name: "Konsertmästare", groupTypes: ["Choir", "Konsertmästeri"] },
    { name: "Gigmästare MK", groupTypes: ["Choir", "Gigmästeri"], groups: ["MK", "Gigmästeri"] },
    { name: "Gigmästare DK", groupTypes: ["Choir", "Gigmästeri"], groups: ["DK", "Gigmästeri"] },
    { name: "Gigmästare KK", groupTypes: ["Choir", "Gigmästeri"], groups: ["KK", "Gigmästeri"] },
    { name: "Stämförälder", groupTypes: ["Section", "Föräldramötet"] },
    { name: "Ekonomiskt Ansvarig", groupTypes: ["Turnékommitté"] }
  ]
}

/**
 * Create the default org structure in a new environment, through this module's own commands and
 * in one transaction. Returns whether anything was created.
 *
 * It runs only while the environment has no groups and no Positions at all. Once the structure
 * exists it belongs to the Admins, so a later run never recreates a default they archived,
 * renamed or deleted; matching defaults by name would undo exactly those changes.
 */
export async function bootstrapOrgStructure(database: OrgStructureDatabase): Promise<{ created: boolean }> {
  return database.transaction(async (tx) => {
    const [anyGroup] = await tx.select({ id: group.id }).from(group).limit(1)
    const [anyPosition] = await tx.select({ id: position.id }).from(position).limit(1)
    if (anyGroup || anyPosition) return { created: false }

    const groupIds = new Map<string, string>()
    for (const definition of DEFAULT_ORG_STRUCTURE.choirs) {
      groupIds.set(definition.name, expectCreated(await createChoir(tx, definition), definition.name).choirId)
    }
    for (const definition of DEFAULT_ORG_STRUCTURE.groups) {
      groupIds.set(definition.name, expectCreated(await createGroup(tx, definition), definition.name).id)
    }
    for (const definition of DEFAULT_ORG_STRUCTURE.positions) {
      const limitedTo = (definition.groups ?? []).map((name) => {
        const id = groupIds.get(name)
        if (!id) throw new Error(`The Position ${definition.name} is limited to ${name}, which is not a default group.`)
        return id
      })
      expectCreated(
        await createPosition(tx, { name: definition.name, groupTypes: definition.groupTypes, groupIds: limitedTo }),
        definition.name
      )
    }
    return { created: true }
  })
}

/** A default that breaks a rule is a bug in the defaults, so it aborts the whole bootstrap. */
function expectCreated<T>(result: { success: true; data: T } | { success: false; error: string }, name: string): T {
  if (!result.success) throw new Error(`Creating the default ${name} was refused: ${result.error}.`)
  return result.data
}

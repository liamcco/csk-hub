import type { GroupType } from "@csk-hub/shared/features/org-structure/model"
import type { Voice } from "@csk-hub/shared/features/voice/model"
import { asc, count, eq, isNull } from "drizzle-orm"
import type { Database } from "@/core/db"
import { user } from "@/core/db/schema/auth"
import { group, groupMember, position, positionHolder, section } from "@/core/db/schema/org-structure"

export type GroupSummary = {
  id: string
  name: string
  type: GroupType
  choirId: string | null
  active: boolean
  memberCount: number
  voices: Voice[]
  holders: { position: string; holder: string }[]
}

/**
 * Every group, archived ones included, with what the admin overviews show of it, ordered by name.
 * The caller authorizes `org.manage`.
 */
export async function listGroupSummaries(database: Database): Promise<GroupSummary[]> {
  const [groups, counts, sections, holders] = await Promise.all([
    database.select().from(group).orderBy(asc(group.name)),
    database
      .select({ groupId: groupMember.groupId, members: count() })
      .from(groupMember)
      .where(isNull(groupMember.endDate))
      .groupBy(groupMember.groupId),
    database.select().from(section),
    database
      .select({ groupId: positionHolder.groupId, position: position.name, holder: user.name })
      .from(positionHolder)
      .innerJoin(position, eq(position.id, positionHolder.positionId))
      .innerJoin(user, eq(user.id, positionHolder.userId))
      .where(isNull(positionHolder.endDate))
      .orderBy(asc(position.name))
  ])

  const memberCounts = new Map(counts.map(({ groupId, members }) => [groupId, members]))
  return groups.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    choirId: row.choirId,
    active: row.active,
    memberCount: memberCounts.get(row.id) ?? 0,
    voices: sections.filter(({ groupId }) => groupId === row.id).map(({ voice }) => voice),
    holders: holders.filter(({ groupId }) => groupId === row.id).map(({ position, holder }) => ({ position, holder }))
  }))
}

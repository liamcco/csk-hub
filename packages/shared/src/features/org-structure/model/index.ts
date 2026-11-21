export { ORG_STRUCTURE_VIOLATIONS, type OrgStructureResult, type OrgStructureViolation } from "./result"

/** Every group type. The database enum takes this list. */
export const GROUP_TYPES = [
  "Choir",
  "Section",
  "Board",
  "GigGroup",
  "Gigmästeri",
  "Sexmästeri",
  "Roddgrupp",
  "Festgrupp",
  "Rephelg",
  "Konsertmästeri",
  "Rekryteringskommitté",
  "Turnékommitté",
  "Valberedning",
  "Webmästeri",
  "Föräldramötet",
  "Arkivarie",
  "Utantillkommitté",
  "Övrig"
] as const

export type GroupType = (typeof GROUP_TYPES)[number]

/**
 * The group types whose Positions are elected posts, as each Board member is elected to one post:
 * a member holds at most one current Position in such a group. Elsewhere, as in a Choir's
 * responsibility groups, a member may hold several.
 */
const ELECTED_POST_GROUP_TYPES: readonly GroupType[] = ["Board"]

export function holdsElectedPosts(type: GroupType) {
  return ELECTED_POST_GROUP_TYPES.includes(type)
}

/** A calendar date, `YYYY-MM-DD`, as Memberships and Position holdings are dated. */
export type IsoDate = string

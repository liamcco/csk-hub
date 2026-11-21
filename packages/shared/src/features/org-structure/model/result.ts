/**
 * Why a groups command was refused. Every rule the module enforces, and every constraint the
 * database enforces on its behalf, surfaces as one of these rather than as a thrown error.
 */
export const ORG_STRUCTURE_VIOLATIONS = [
  "invalid-date",
  "group-not-found",
  "group-archived",
  "group-name-taken",
  "choir-not-found",
  "choir-created-with-sections",
  "section-count",
  "voice-in-several-sections",
  "section-archived-with-choir",
  "already-member",
  "not-a-member",
  "not-a-choir-member",
  "section-requires-placement",
  "voice-not-sung-in-choir",
  "voice-not-sung-in-section",
  "already-in-section",
  "not-a-singer",
  "same-voice",
  "position-not-found",
  "position-name-taken",
  "position-not-allowed",
  "position-limited-to-other-groups",
  "position-limit-type-not-allowed",
  "position-held-outside-limit",
  "position-taken",
  "position-in-use",
  "already-holding-position",
  "already-holding-elected-post",
  "not-holding-position",
  "period-conflict"
] as const

export type OrgStructureViolation = (typeof ORG_STRUCTURE_VIOLATIONS)[number]

export type OrgStructureResult<T> = { success: true; data: T } | { success: false; error: OrgStructureViolation }

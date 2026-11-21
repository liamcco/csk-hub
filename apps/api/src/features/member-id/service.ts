import { and, eq, gt, isNull } from "drizzle-orm"
import type { Database } from "@/core/db"
import { session, user } from "@/core/db/schema/auth"
import type { ResolvedRequest } from "@/core/http"
import { listCurrentChoirAffiliationsOfUsers } from "@/features/org-structure"
import { issueMemberIdToken, MEMBER_ID_ROTATION_MS, MEMBER_ID_VALIDITY_MS, readMemberIdToken } from "./token"

export class MemberIdError extends Error {
  constructor(readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "INVALID_CODE") {
    super(code)
  }
}

/** One Member ID operation: the caller's freshly resolved authority and where to read facts. */
export type MemberIdContext = Readonly<{
  request: ResolvedRequest
  database: Database
  /** The server secret; Member ID derives its own encryption key from it. */
  secret: string
}>

function requireAccess({ authorization }: ResolvedRequest) {
  if (!authorization.actor) throw new MemberIdError("UNAUTHENTICATED")
  if (!authorization.can({ action: "memberId.issue" })) throw new MemberIdError("FORBIDDEN")
  return authorization.requirePermission({ action: "memberId.issue" })
}

async function getProfile(database: Database, userId: string) {
  const [member] = await database
    .select({ id: user.id, name: user.name, image: user.image, banned: user.banned })
    .from(user)
    .where(eq(user.id, userId))
  if (!member || member.banned === true) throw new MemberIdError("INVALID_CODE")
  const affiliations = await listCurrentChoirAffiliationsOfUsers(database, [userId])
  return {
    id: member.id,
    name: member.name,
    image: member.image,
    accountStatus: "active" as const,
    choirs: affiliations.filter((group) => group.type === "Choir").map(({ groupId, name }) => ({ id: groupId, name }))
  }
}

/** Fresh, minimal own-account data and scanner availability; never trusts session-cached roles. */
export async function getMemberIdSession({ request, database }: MemberIdContext) {
  const actor = requireAccess(request)
  return {
    member: await getProfile(database, actor.userId),
    canVerify: request.authorization.can({ action: "memberId.verify" })
  }
}

/** Issues a ten-second ID tied to the caller's current, non-impersonated login session. */
export async function issueMemberId({ request, secret }: MemberIdContext) {
  const actor = requireAccess(request)
  if (!request.sessionId || request.impersonatedBy) throw new MemberIdError("UNAUTHENTICATED")
  const issuedAt = Date.now()
  return {
    token: issueMemberIdToken({ userId: actor.userId, sessionId: request.sessionId, issuedAt }, secret),
    issuedAt,
    expiresAt: issuedAt + MEMBER_ID_VALIDITY_MS,
    rotateAfterMs: MEMBER_ID_ROTATION_MS
  }
}

/** Admin-only visual verification. Rechecks the subject's stored session and current User/Choir facts; writes no history. */
export async function verifyMemberId({ request, database, secret }: MemberIdContext, token: string) {
  requireAccess(request)
  if (!request.authorization.can({ action: "memberId.verify" })) throw new MemberIdError("FORBIDDEN")
  const claims = readMemberIdToken(token, secret, Date.now())
  if (!claims) throw new MemberIdError("INVALID_CODE")
  const [stored] = await database
    .select({ id: session.id })
    .from(session)
    .where(
      and(
        eq(session.id, claims.sessionId),
        eq(session.userId, claims.userId),
        gt(session.expiresAt, new Date()),
        isNull(session.impersonatedBy)
      )
    )
  if (!stored) throw new MemberIdError("INVALID_CODE")
  const member = await getProfile(database, claims.userId)
  // Check again after database reads so a slow lookup cannot validate an expired QR.
  const verifiedAt = Date.now()
  if (!readMemberIdToken(token, secret, verifiedAt)) throw new MemberIdError("INVALID_CODE")
  return { member, verifiedAt }
}

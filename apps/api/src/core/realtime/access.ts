import { and, eq, gt, isNull, or } from "drizzle-orm"
import type { Database } from "@/core/db"
import { session, user } from "@/core/db/schema/auth"

export type ActivitySession = { userId: string; sessionId: string }

/** The database check bypasses the cookie cache for long-lived streams and acknowledgements. */
export async function isActivitySessionActive(database: Database, identity: ActivitySession) {
  const [active] = await database
    .select({ id: session.id })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .where(
      and(
        eq(session.id, identity.sessionId),
        eq(session.userId, identity.userId),
        gt(session.expiresAt, new Date()),
        isNull(session.impersonatedBy),
        or(eq(user.banned, false), isNull(user.banned))
      )
    )
  return Boolean(active)
}

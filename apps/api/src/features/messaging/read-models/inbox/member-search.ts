import { and, asc, eq, isNull, ne, or } from "drizzle-orm"
import { user } from "@/core/db/schema/auth"
import { ilike } from "@/core/db/sql"
import type { MessagingContext } from "../../model/context"

const MEMBER_SEARCH_LIMIT = 20

export async function searchMembers(query: string, context: MessagingContext) {
  const { database, authorize } = context
  const { userId } = await authorize({ action: "app.access" })
  const search = query.trim()

  if (!search) return []

  const pattern = `%${search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`

  return database
    .select({ id: user.id, name: user.name, username: user.username })
    .from(user)
    .where(
      and(
        ne(user.id, userId),
        or(eq(user.banned, false), isNull(user.banned)),
        or(ilike(user.name, pattern), ilike(user.username, pattern))
      )
    )
    .orderBy(asc(user.name), asc(user.username))
    .limit(MEMBER_SEARCH_LIMIT)
}

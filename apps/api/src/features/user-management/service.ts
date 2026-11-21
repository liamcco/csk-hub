import { and, asc, eq, exists, isNotNull } from "drizzle-orm"
import type { Database } from "@/core/db"
import { account, user } from "@/core/db/schema/auth"

/** Every User, by name, with their status. The caller authorizes `user.administer`. */
export async function listUsers(database: Database) {
  return database
    .select({
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      emailVerified: user.emailVerified,
      hasPassword: exists(
        database
          .select({ id: account.id })
          .from(account)
          .where(and(eq(account.userId, user.id), eq(account.providerId, "credential"), isNotNull(account.password)))
      ),
      role: user.role,
      inactive: user.banned,
      createdAt: user.createdAt
    })
    .from(user)
    .orderBy(asc(user.name), asc(user.email))
}

export type UserListItem = Awaited<ReturnType<typeof listUsers>>[number]

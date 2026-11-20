import { and, eq, exists, isNotNull, isNull, or } from "drizzle-orm"
import type { Database } from "@/core/db"
import { account, user } from "@/core/db/schema/auth"
import type { AuthApi } from "@/core/http"
import { logger } from "@/core/logging"
import { ROUTES } from "@/core/navigation/site"
import { getErrorCode, getErrorName, getErrorStatus } from "@/shared/errors"
import { type AccessRole, ADMIN_ROLE, hasAdminRole, USER_ROLE } from "@/shared/roles"

/**
 * Who runs a User administration command and how. The caller has already established
 * `user.administer`; Better Auth's admin operations check the session in `headers` again.
 */
export type UserAdministration = {
  database: Database
  authApi: AuthApi
  headers: Headers
  actorId: string
}

/** A rule a User administration command broke; `UNAVAILABLE` when Better Auth failed. */
export type UserCommandError =
  | "USER_NOT_FOUND"
  | "ALREADY_ACTIVE"
  | "ALREADY_INACTIVE"
  | "CANNOT_CHANGE_SELF"
  | "LAST_ADMIN"
  | "DEACTIVATE_FIRST"
  | "CONFIRMATION_MISMATCH"
  | "ALREADY_ACTIVATED"
  | "UNAVAILABLE"

export type UserCommandResult = { ok: true } | { ok: false; error: UserCommandError }

const done: UserCommandResult = { ok: true }
const refuse = (error: UserCommandError): UserCommandResult => ({ ok: false, error })

async function getUser(database: Database, userId: string) {
  const [targetUser] = await database
    .select({
      id: user.id,
      banned: user.banned,
      email: user.email,
      name: user.name,
      role: user.role,
      hasPassword: exists(
        database
          .select({ id: account.id })
          .from(account)
          .where(and(eq(account.userId, user.id), eq(account.providerId, "credential"), isNotNull(account.password)))
      )
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
  return targetUser
}

async function isLastAdmin(database: Database, targetUser: { role: string | null }, activeOnly = false) {
  if (!hasAdminRole(targetUser.role)) return false

  const activeUsers = activeOnly
    ? await database
        .select({ role: user.role })
        .from(user)
        .where(or(eq(user.banned, false), isNull(user.banned)))
    : await database.select({ role: user.role }).from(user)

  return activeUsers.filter((candidate) => hasAdminRole(candidate.role)).length <= 1
}

async function run(action: string, operation: () => Promise<unknown>): Promise<UserCommandResult> {
  try {
    await operation()
    return done
  } catch (error) {
    logger.error(`admin.users.${action}-failed`, {
      errorCode: getErrorCode(error),
      errorName: getErrorName(error),
      status: getErrorStatus(error)
    })
    return refuse("UNAVAILABLE")
  }
}

export async function activateUserCommand(context: UserAdministration, userId: string) {
  const target = await getUser(context.database, userId)
  if (!target) return refuse("USER_NOT_FOUND")
  if (!target.banned) return refuse("ALREADY_ACTIVE")
  return run("activate", () => context.authApi.unbanUser({ headers: context.headers, body: { userId: target.id } }))
}

export async function deactivateUserCommand(context: UserAdministration, userId: string) {
  const target = await getUser(context.database, userId)
  if (!target) return refuse("USER_NOT_FOUND")
  if (target.id === context.actorId) return refuse("CANNOT_CHANGE_SELF")
  if (target.banned) return refuse("ALREADY_INACTIVE")
  if (await isLastAdmin(context.database, target, true)) return refuse("LAST_ADMIN")
  return run("deactivate", () =>
    context.authApi.banUser({
      headers: context.headers,
      body: { userId: target.id, banReason: "Deactivated by an admin" }
    })
  )
}

export async function eraseUserCommand(context: UserAdministration, userId: string, confirmation: string | undefined) {
  const target = await getUser(context.database, userId)
  if (!target) return refuse("USER_NOT_FOUND")
  if (target.id === context.actorId) return refuse("CANNOT_CHANGE_SELF")
  if (!target.banned) return refuse("DEACTIVATE_FIRST")
  if (await isLastAdmin(context.database, target)) return refuse("LAST_ADMIN")
  if (confirmation !== `delete ${target.name}`) return refuse("CONFIRMATION_MISMATCH")
  return run("erase", () => context.authApi.removeUser({ headers: context.headers, body: { userId: target.id } }))
}

export async function resendInvitationCommand(context: UserAdministration, userId: string) {
  const target = await getUser(context.database, userId)
  if (!target) return refuse("USER_NOT_FOUND")
  if (target.hasPassword) return refuse("ALREADY_ACTIVATED")
  return run("resend-invitation", () =>
    context.authApi.signInMagicLink({
      headers: context.headers,
      body: {
        email: target.email,
        name: target.name,
        callbackURL: ROUTES.activate,
        errorCallbackURL: ROUTES.activationFailed
      }
    })
  )
}

export async function changeUserRoleCommand(context: UserAdministration, userId: string, requested: AccessRole[]) {
  const target = await getUser(context.database, userId)
  if (!target) return refuse("USER_NOT_FOUND")
  if (target.id === context.actorId) return refuse("CANNOT_CHANGE_SELF")

  const roles: AccessRole[] = requested.includes(ADMIN_ROLE) ? [USER_ROLE, ADMIN_ROLE] : [USER_ROLE]
  if (!roles.includes(ADMIN_ROLE) && (await isLastAdmin(context.database, target, true))) return refuse("LAST_ADMIN")
  return run("change-role", () =>
    context.authApi.setRole({ headers: context.headers, body: { userId: target.id, role: roles } })
  )
}

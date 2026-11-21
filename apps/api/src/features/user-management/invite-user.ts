import { logger } from "@csk-hub/shared/core/logging"
import { ROUTES } from "@csk-hub/shared/core/navigation/site"
import { getErrorCode, getErrorName, getErrorStatus } from "@csk-hub/shared/shared/errors"
import { USER_ROLE } from "@csk-hub/shared/shared/roles"
import { inArray } from "drizzle-orm"
import type { Database } from "@/core/db"
import { user } from "@/core/db/schema/auth"
import type { AuthApi } from "@/core/http"

/** How an invitation runs: Better Auth's admin operations, as the calling Admin. */
export type Inviter = { authApi: AuthApi; headers: Headers }

export type InviteUserInput = { name: string; email: string }
export type InviteUserResult =
  | { kind: "sent"; id: string }
  | { kind: "email-failed"; id: string }
  | { kind: "already-exists" }
  | { kind: "creation-failed" }

const INVITE_CONCURRENCY = 5

/** Invites Users a few at a time, answering each in input order. The caller authorizes. */
export async function inviteUsers(inviter: Inviter, inputs: InviteUserInput[]): Promise<InviteUserResult[]> {
  const results: InviteUserResult[] = []
  for (let index = 0; index < inputs.length; index += INVITE_CONCURRENCY) {
    const batch = inputs.slice(index, index + INVITE_CONCURRENCY)
    results.push(...(await Promise.all(batch.map((input) => inviteUser(inviter, input)))))
  }
  return results
}

/** Creates a User without a password and sends the magic link that activates them. The caller authorizes. */
export async function inviteUser({ authApi, headers }: Inviter, input: InviteUserInput): Promise<InviteUserResult> {
  let id: string
  try {
    const created = await authApi.createUser({
      headers,
      body: { name: input.name, email: input.email, role: USER_ROLE }
    })
    id = created.user.id
  } catch (error) {
    if (getErrorCode(error) === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") return { kind: "already-exists" }

    logger.error("admin.users.create-failed", {
      errorCode: getErrorCode(error),
      errorName: getErrorName(error),
      status: getErrorStatus(error)
    })
    return { kind: "creation-failed" }
  }

  try {
    await authApi.signInMagicLink({
      headers,
      body: {
        email: input.email,
        name: input.name,
        callbackURL: ROUTES.activate,
        errorCallbackURL: ROUTES.activationFailed
      }
    })
    return { kind: "sent", id }
  } catch (error) {
    logger.error("admin.users.invite-dispatch-failed", {
      errorCode: getErrorCode(error),
      errorName: getErrorName(error),
      status: getErrorStatus(error)
    })
    return { kind: "email-failed", id }
  }
}

/** Which of these emails already belong to a User, normalized to lower case. The caller authorizes. */
export async function findExistingEmails(database: Database, emails: string[]) {
  const normalized = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))]
  if (normalized.length === 0) return []
  const users = await database.select({ email: user.email }).from(user).where(inArray(user.email, normalized))
  return users.map((row) => row.email.toLowerCase())
}

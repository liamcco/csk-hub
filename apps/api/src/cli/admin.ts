import { ROUTES } from "@csk-hub/shared/core/navigation/site"
import { ADMIN_ROLE, parseRoles } from "@csk-hub/shared/shared/roles"
import { eq, sql } from "drizzle-orm"
import type { Auth } from "@/core/auth/create-auth"
import type { Db } from "@/core/db/client"
import { user } from "@/core/db/schema/auth"

type AdminCommand = {
  auth: Auth
  database: Db
  email: string
}

export type AdminRefusal =
  /** No account has this email. */
  | "not-found"
  /** The account exists but is not an Admin; promoting it is a separate, explicit operation. */
  | "not-admin"
  /** The Admin is deactivated; reactivating is a separate, explicit operation. */
  | "deactivated"

export type AdminOutcome =
  | { kind: "invited" }
  | { kind: "activation-resent" }
  | { kind: "recovery-sent" }
  | { kind: "unchanged" }
  | { kind: "refused"; reason: AdminRefusal }

/**
 * Create the named Admin through Better Auth and send an activation invitation, as an Admin's
 * invitation would, with no default password. Another Admin existing is no reason to refuse.
 *
 * When the account is already an Admin, it asks (`confirm`) whether to resend the activation, if
 * they never activated, or to send a recovery email. It never promotes, reactivates or resets
 * two-factor for an existing account: those stay separate operations.
 */
export async function bootstrapAdmin({
  auth,
  database,
  email,
  name,
  confirm
}: AdminCommand & { name: string; confirm: (question: string) => Promise<boolean> }): Promise<AdminOutcome> {
  const existing = await findAccount(database, email)

  if (!existing) {
    await auth.api.createUser({ body: { email, name, role: ADMIN_ROLE } })
    await sendActivation(auth, email, name)
    return { kind: "invited" }
  }

  const refusal = refusalFor(existing)
  if (refusal) return { kind: "refused", reason: refusal }

  if (!existing.emailVerified) {
    if (!(await confirm(`${existing.email} is an Admin who has not activated yet. Resend the activation email?`))) {
      return { kind: "unchanged" }
    }
    await sendActivation(auth, existing.email, existing.name)
    return { kind: "activation-resent" }
  }

  if (!(await confirm(`${existing.email} is already an active Admin. Send them a password-reset email?`))) {
    return { kind: "unchanged" }
  }
  await sendRecovery(auth, existing.email)
  return { kind: "recovery-sent" }
}

/**
 * Send a password-reset email to an existing, active Admin. Members who forget their password use
 * the app's own reset flow; this is for regaining administration when nobody can sign in to do it.
 */
export async function recoverAdmin({ auth, database, email }: AdminCommand): Promise<AdminOutcome> {
  const existing = await findAccount(database, email)
  if (!existing) return { kind: "refused", reason: "not-found" }

  const refusal = refusalFor(existing)
  if (refusal) return { kind: "refused", reason: refusal }

  await sendRecovery(auth, existing.email)
  return { kind: "recovery-sent" }
}

type Account = { email: string; name: string; role: string | null; banned: boolean | null; emailVerified: boolean }

async function findAccount(database: Db, email: string): Promise<Account | undefined> {
  const [row] = await database
    .select({
      email: user.email,
      name: user.name,
      role: user.role,
      banned: user.banned,
      emailVerified: user.emailVerified
    })
    .from(user)
    .where(eq(sql`lower(${user.email})`, email.toLowerCase()))
  return row
}

function refusalFor(account: Account): AdminRefusal | undefined {
  if (!parseRoles(account.role).includes(ADMIN_ROLE)) return "not-admin"
  if (account.banned) return "deactivated"
  return undefined
}

/** The same magic link an Admin's invitation sends, leading to the activation page. */
async function sendActivation(auth: Auth, email: string, name: string) {
  await auth.api.signInMagicLink({
    headers: new Headers(),
    body: { email, name, callbackURL: ROUTES.activate, errorCallbackURL: ROUTES.activationFailed }
  })
}

/** The same reset email the app's forgotten-password flow sends. */
async function sendRecovery(auth: Auth, email: string) {
  await auth.api.requestPasswordReset({
    body: { email, redirectTo: `${ROUTES.resetPassword}?email=${encodeURIComponent(email)}` }
  })
}

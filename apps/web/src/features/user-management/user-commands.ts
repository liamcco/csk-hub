import {
  activateUser as activate,
  changeUserRoles,
  deactivateUser as deactivate,
  eraseUser as erase,
  findExistingUserEmails as findExisting,
  importUsers as invite,
  inviteUser,
  resendInvitation as resend
} from "@csk-hub/contract/client"
import type { ImportCsvError, ImportUserSkipped } from "@csk-hub/shared/features/user-management/import/schemas"
import { accessRoleNames } from "@csk-hub/shared/shared/roles"
import { browserApiClient as client } from "@/core/api-client/browser"
import { type ApiResult, errorCode } from "@/core/api-client/result"
import { formText as text } from "@/shared/forms/form-data"
import type { UserCommandError, UserCommandState } from "./command-state"

type UserAction = Extract<UserCommandState, { status: "success" }>["action"]

/** The message the admin screen shows for each refusal code. */
const REFUSALS: Record<string, UserCommandError | Partial<Record<UserAction, UserCommandError>>> = {
  USER_NOT_FOUND: "userNotFound",
  ALREADY_ACTIVE: "alreadyActive",
  ALREADY_INACTIVE: "alreadyInactive",
  CANNOT_CHANGE_SELF: {
    deactivate: "cannotDeactivateSelf",
    delete: "cannotEraseSelf",
    role: "cannotChangeOwnRole"
  },
  LAST_ADMIN: {
    deactivate: "cannotDeactivateLastAdmin",
    delete: "cannotEraseLastAdmin",
    role: "cannotDemoteLastAdmin"
  },
  DEACTIVATE_FIRST: "deactivateFirst",
  CONFIRMATION_MISMATCH: "confirmationMismatch",
  ALREADY_ACTIVATED: "alreadyActivated"
}

function refusal(action: UserAction, code: string | null): UserCommandError {
  const error = code ? REFUSALS[code] : undefined
  return (typeof error === "object" ? error[action] : error) ?? "unavailable"
}

function roles(formData: FormData) {
  return formData
    .getAll("roles")
    .filter((role): role is (typeof accessRoleNames)[number] => accessRoleNames.includes(role as never))
}

function send(action: UserAction, formData: FormData): Promise<ApiResult<unknown>> {
  const path = { userId: text(formData, "userId") }
  switch (action) {
    case "activate":
      return activate({ client, path })
    case "deactivate":
      return deactivate({ client, path })
    case "delete":
      return erase({ client, path, body: { confirmation: text(formData, "confirmation") || undefined } })
    case "invite":
      return resend({ client, path })
    case "role":
      return changeUserRoles({ client, path, body: { roles: roles(formData) } })
  }
}

/** Runs one admin command on a User through the API. */
export function userCommand(action: UserAction) {
  return async (_state: UserCommandState, formData: FormData): Promise<UserCommandState> => {
    try {
      const { data, error } = await send(action, formData)
      if (data) return { status: "success", action }
      return { status: "error", error: refusal(action, errorCode(error)) }
    } catch {
      return { status: "error", error: "unavailable" }
    }
  }
}

export type AddUserState =
  | { status: "idle" }
  | {
      status: "error"
      kind: "name-required" | "email-required" | "email-invalid" | "email-exists" | "create-failed" | "unknown"
    }
  | { status: "success"; name: string; email: string; createdAt: number }
  | { status: "email-failed"; name: string; email: string; createdAt: number }

const INVITE_FAILURES = {
  NAME_REQUIRED: "name-required",
  EMAIL_REQUIRED: "email-required",
  EMAIL_INVALID: "email-invalid",
  EMAIL_EXISTS: "email-exists",
  UNAVAILABLE: "create-failed"
} as const

/** Invites one User through the API. */
export async function addUser(_state: AddUserState, formData: FormData): Promise<AddUserState> {
  const name = text(formData, "name").trim()
  const email = text(formData, "email").trim()
  try {
    const { data, error } = await inviteUser({ client, body: { name, email } })
    if (!data) {
      const code = errorCode(error) as keyof typeof INVITE_FAILURES | null
      return { status: "error", kind: (code && INVITE_FAILURES[code]) || "unknown" }
    }
    const status = data.delivery === "sent" ? "success" : "email-failed"
    return { status, name, email: email.toLowerCase(), createdAt: Date.now() }
  } catch {
    return { status: "error", kind: "unknown" }
  }
}

/** Which of these emails already belong to a User, lower-cased. */
export async function findExistingUserEmails(emails: string[]) {
  const { data } = await findExisting({ client, body: { emails } })
  if (!data) throw new Error("Existing emails could not be checked")
  return data.emails
}

export type ImportUsersState =
  | { status: "idle" }
  | {
      status: "error"
      error:
        | { kind: "invalid-preview" }
        | { kind: "file-required" }
        | { kind: "file-extension" }
        | { kind: "file-too-large" }
        | { kind: "csv-parse"; code: ImportCsvError }
        | { kind: "no-valid-rows" }
    }
  | {
      status: "success"
      created: Array<{ row: number; name: string; email: string }>
      emailFailed: Array<{ row: number; name: string; email: string }>
      failed: Array<{ row: number; error: "email-exists" | "create-failed" }>
      skipped: ImportUserSkipped[]
    }

/** Invites the reviewed rows of an import through the API. */
export async function importUsers(_state: ImportUsersState, formData: FormData): Promise<ImportUsersState> {
  let users: { row: number; name: string; email: string }[]
  try {
    users = JSON.parse(text(formData, "users"))
  } catch {
    return { status: "error", error: { kind: "invalid-preview" } }
  }
  const { data } = await invite({ client, body: { users } }).catch(() => ({ data: undefined }))
  if (!data) return { status: "error", error: { kind: "invalid-preview" } }
  return {
    status: "success",
    created: data.created,
    emailFailed: data.emailFailed,
    failed: data.failed.map(({ row, error }) => ({
      row,
      error: error === "EMAIL_EXISTS" ? ("email-exists" as const) : ("create-failed" as const)
    })),
    skipped: []
  }
}

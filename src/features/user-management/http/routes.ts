import { createRoute, z } from "@hono/zod-openapi"
import type { Context } from "hono"
import { type ApiEnv, createRouter, errorResponses } from "@/core/http"
import { accessRoleNames } from "@/shared/roles"
import { validationMessageIds } from "@/shared/schemas"
import { addUserSchema } from "../add/schemas"
import {
  activateUserCommand,
  changeUserRoleCommand,
  deactivateUserCommand,
  eraseUserCommand,
  resendInvitationCommand,
  type UserAdministration,
  type UserCommandResult
} from "../commands"
import { MAX_IMPORT_USERS } from "../import/schemas"
import { findExistingEmails, inviteUser, inviteUsers } from "../invite-user"
import { listUsers } from "../service"

function json<T extends z.ZodType>(description: string, schema: T) {
  return { description, content: { "application/json": { schema } } }
}

function body<T extends z.ZodType>(schema: T) {
  return { body: { required: true, content: { "application/json": { schema } } } }
}

const UserCommandErrorSchema = z
  .object({
    code: z
      .enum([
        "USER_NOT_FOUND",
        "ALREADY_ACTIVE",
        "ALREADY_INACTIVE",
        "CANNOT_CHANGE_SELF",
        "LAST_ADMIN",
        "DEACTIVATE_FIRST",
        "CONFIRMATION_MISMATCH",
        "ALREADY_ACTIVATED",
        "UNAVAILABLE"
      ])
      .openapi({ description: "The rule a User administration command broke. Tolerate unknown codes." })
  })
  .openapi("UserCommandError")

const InviteErrorSchema = z
  .object({
    code: z.enum(["NAME_REQUIRED", "EMAIL_REQUIRED", "EMAIL_INVALID", "EMAIL_EXISTS", "UNAVAILABLE"])
  })
  .openapi("InviteError")

const UserSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    username: z.string().nullable(),
    email: z.string(),
    emailVerified: z.boolean(),
    hasPassword: z.boolean().openapi({ description: "False until the User completes activation." }),
    role: z.string().nullable(),
    inactive: z.boolean().nullable(),
    createdAt: z.string().openapi({ format: "date-time" })
  })
  .openapi("AdministeredUser")

const InviteeSchema = z.object({ name: z.string().max(200), email: z.string().max(320) })
const Done = z.object({ id: z.string() }).openapi("UserCommandResult")
const userParams = z.object({ userId: z.string().min(1) })

const commandResponses = {
  200: json("Done.", Done),
  400: json("The command broke a rule, or the request failed validation.", UserCommandErrorSchema),
  401: errorResponses[401],
  403: errorResponses[403],
  404: json("`USER_NOT_FOUND`: no such User.", UserCommandErrorSchema),
  500: json("`UNAVAILABLE`: Better Auth could not complete the change.", UserCommandErrorSchema)
}

function command(path: string, operationId: string, summary: string) {
  return createRoute({
    method: "post",
    path: `/users/{userId}/${path}`,
    operationId,
    summary,
    tags: ["users"],
    request: { params: userParams },
    responses: commandResponses
  })
}

const routes = {
  listUsers: createRoute({
    method: "get",
    path: "/users",
    operationId: "listUsers",
    summary: "Every User with their activation and status, by name. Admins only.",
    tags: ["users"],
    responses: {
      200: json("Users.", z.object({ items: z.array(UserSchema) }).openapi("AdministeredUsers")),
      401: errorResponses[401],
      403: errorResponses[403]
    }
  }),
  inviteUser: createRoute({
    method: "post",
    path: "/users",
    operationId: "inviteUser",
    summary: "Creates a User without a password and emails the magic link that activates them. Admins only.",
    tags: ["users"],
    request: body(InviteeSchema),
    responses: {
      201: json(
        "Created. `email-failed` means the User exists but the invitation email could not be sent.",
        z.object({ id: z.string(), delivery: z.enum(["sent", "email-failed"]) }).openapi("InvitedUser")
      ),
      400: json("The name or email is missing or malformed.", InviteErrorSchema),
      401: errorResponses[401],
      403: errorResponses[403],
      409: json("`EMAIL_EXISTS`: a User already has this email.", InviteErrorSchema),
      500: json("`UNAVAILABLE`: the User could not be created.", InviteErrorSchema)
    }
  }),
  findExistingUserEmails: createRoute({
    method: "post",
    path: "/users/emails/existing",
    operationId: "findExistingUserEmails",
    summary: "Which of these emails already belong to a User, for reviewing an import. Admins only.",
    description: "A read sent as POST so the emails stay out of URLs and logs.",
    tags: ["users"],
    request: body(z.object({ emails: z.array(z.string().max(320)).max(MAX_IMPORT_USERS * 2) })),
    responses: {
      200: json("The taken emails, lower-cased.", z.object({ emails: z.array(z.string()) })),
      400: errorResponses[400],
      401: errorResponses[401],
      403: errorResponses[403]
    }
  }),
  importUsers: createRoute({
    method: "post",
    path: "/users/import",
    operationId: "importUsers",
    summary: "Invites the reviewed rows of an import, reporting each row's outcome. Admins only.",
    tags: ["users"],
    request: body(
      z
        .object({
          users: z
            .array(z.object({ row: z.int().positive(), name: z.string().trim().min(1), email: z.email() }))
            .min(1)
            .max(MAX_IMPORT_USERS)
        })
        .openapi("UserImport")
    ),
    responses: {
      200: json(
        "Each row's outcome.",
        z
          .object({
            created: z.array(z.object({ row: z.int(), name: z.string(), email: z.string() })),
            emailFailed: z.array(z.object({ row: z.int(), name: z.string(), email: z.string() })),
            failed: z.array(z.object({ row: z.int(), error: z.enum(["EMAIL_EXISTS", "UNAVAILABLE"]) }))
          })
          .openapi("UserImportResult")
      ),
      400: errorResponses[400],
      401: errorResponses[401],
      403: errorResponses[403]
    }
  }),
  activateUser: command("activate", "activateUser", "Reactivates an inactive User. Admins only."),
  deactivateUser: command(
    "deactivate",
    "deactivateUser",
    "Deactivates a User and ends their sessions. Never the caller or the last active Admin."
  ),
  eraseUser: createRoute({
    method: "post",
    path: "/users/{userId}/erase",
    operationId: "eraseUser",
    summary: "Erases an inactive User. The confirmation must read `delete <name>`.",
    tags: ["users"],
    request: { params: userParams, ...body(z.object({ confirmation: z.string().max(400).optional() })) },
    responses: commandResponses
  }),
  resendInvitation: command(
    "invitation",
    "resendInvitation",
    "Sends a new activation link to a User who has not activated."
  ),
  changeUserRoles: createRoute({
    method: "post",
    path: "/users/{userId}/roles",
    operationId: "changeUserRoles",
    summary: "Sets a User's roles; every User keeps `user`. Never the caller, and never demotes the last active Admin.",
    tags: ["users"],
    request: { params: userParams, ...body(z.object({ roles: z.array(z.enum(accessRoleNames)).min(1) })) },
    responses: commandResponses
  })
}

/** Establishes `user.administer` for this request and how commands act as the caller. */
async function administration(c: Context<ApiEnv>): Promise<UserAdministration> {
  const { authorization } = await c.var.resolveRequest()
  const actor = authorization.requirePermission({ action: "user.administer" })
  return { database: c.var.database, authApi: c.var.authApi, headers: c.req.raw.headers, actorId: actor.userId }
}

function answer(c: Context, userId: string, result: UserCommandResult) {
  if (result.ok) return c.json({ id: userId }, 200)
  const status = result.error === "USER_NOT_FOUND" ? 404 : result.error === "UNAVAILABLE" ? 500 : 400
  return c.json({ code: result.error }, status)
}

function inviteFailure(issues: { path: PropertyKey[]; message: string }[]) {
  const issue = issues[0]
  if (issue?.path[0] === "name") return "NAME_REQUIRED" as const
  return issue?.message === validationMessageIds.required ? ("EMAIL_REQUIRED" as const) : ("EMAIL_INVALID" as const)
}

/** User administration, mounted under `/api/v1`. */
export const usersRouter = createRouter()

usersRouter.openapi(routes.listUsers, async (c) => {
  const { database } = await administration(c)
  const users = await listUsers(database)
  return c.json(
    {
      items: users.map((item) => ({
        ...item,
        hasPassword: Boolean(item.hasPassword),
        createdAt: item.createdAt.toISOString()
      }))
    },
    200
  )
})

usersRouter.openapi(routes.inviteUser, async (c) => {
  const context = await administration(c)
  const input = addUserSchema.safeParse(c.req.valid("json"))
  if (!input.success) return c.json({ code: inviteFailure(input.error.issues) }, 400)
  const result = await inviteUser(context, input.data)
  if (result.kind === "already-exists") return c.json({ code: "EMAIL_EXISTS" as const }, 409)
  if (result.kind === "creation-failed") return c.json({ code: "UNAVAILABLE" as const }, 500)
  return c.json(
    { id: result.id, delivery: result.kind === "sent" ? ("sent" as const) : ("email-failed" as const) },
    201
  )
})

usersRouter.openapi(routes.findExistingUserEmails, async (c) => {
  const { database } = await administration(c)
  return c.json({ emails: await findExistingEmails(database, c.req.valid("json").emails) }, 200)
})

usersRouter.openapi(routes.importUsers, async (c) => {
  const context = await administration(c)
  const rows = c.req.valid("json").users
  const results = await inviteUsers(context, rows)
  const created: { row: number; name: string; email: string }[] = []
  const emailFailed: { row: number; name: string; email: string }[] = []
  const failed: { row: number; error: "EMAIL_EXISTS" | "UNAVAILABLE" }[] = []
  for (const [index, result] of results.entries()) {
    const { row, name, email } = rows[index]
    if (result.kind === "sent") created.push({ row, name, email })
    else if (result.kind === "email-failed") emailFailed.push({ row, name, email })
    else failed.push({ row, error: result.kind === "already-exists" ? "EMAIL_EXISTS" : "UNAVAILABLE" })
  }
  return c.json({ created, emailFailed, failed }, 200)
})

usersRouter.openapi(routes.activateUser, async (c) => {
  const { userId } = c.req.valid("param")
  return answer(c, userId, await activateUserCommand(await administration(c), userId))
})

usersRouter.openapi(routes.deactivateUser, async (c) => {
  const { userId } = c.req.valid("param")
  return answer(c, userId, await deactivateUserCommand(await administration(c), userId))
})

usersRouter.openapi(routes.eraseUser, async (c) => {
  const { userId } = c.req.valid("param")
  const { confirmation } = c.req.valid("json")
  return answer(c, userId, await eraseUserCommand(await administration(c), userId, confirmation))
})

usersRouter.openapi(routes.resendInvitation, async (c) => {
  const { userId } = c.req.valid("param")
  return answer(c, userId, await resendInvitationCommand(await administration(c), userId))
})

usersRouter.openapi(routes.changeUserRoles, async (c) => {
  const { userId } = c.req.valid("param")
  const { roles } = c.req.valid("json")
  return answer(c, userId, await changeUserRoleCommand(await administration(c), userId, roles))
})

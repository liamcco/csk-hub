import { locales } from "@csk-hub/shared/core/i18n/locales"
import { createRoute, z } from "@hono/zod-openapi"
import { eq } from "drizzle-orm"
import { user } from "@/core/db/schema/auth"
import { createRouter, errorResponses } from "@/core/http"
import { getUserPreferences } from "@/core/preferences"

const CurrentActorSchema = z
  .object({
    userId: z.string(),
    isAdmin: z.boolean(),
    impersonatedBy: z
      .string()
      .nullable()
      .openapi({ description: "The impersonating Admin's User ID, or null for the User's own session." })
  })
  .openapi("CurrentActor")

const getCurrentActor = createRoute({
  method: "get",
  path: "/me",
  operationId: "getCurrentActor",
  summary: "The signed-in, active User behind this request, freshly resolved.",
  tags: ["session"],
  responses: {
    200: { description: "The current actor.", content: { "application/json": { schema: CurrentActorSchema } } },
    401: errorResponses[401]
  }
})

const CurrentCapabilitiesSchema = z
  .object({
    user: z.object({ id: z.string(), name: z.string(), image: z.string().nullable() }),
    locale: z
      .enum(locales)
      .nullable()
      .openapi({ description: "The User's saved locale, or null. A browser's own locale choice takes precedence." }),
    permissions: z
      .object({
        admin: z.boolean().openapi({ description: "May open the administration area." }),
        administerUsers: z.boolean(),
        manageOrganisation: z.boolean().openapi({ description: "May manage Groups, Memberships and Positions." }),
        administerEvents: z.boolean().openapi({ description: "May administer all Events and Locations." }),
        broadcastNotifications: z.boolean()
      })
      .openapi({ description: "UI hints for the current User, computed per request. Operations re-check authority." })
  })
  .openapi("CurrentCapabilities")

const getCurrentCapabilities = createRoute({
  method: "get",
  path: "/me/capabilities",
  operationId: "getCurrentCapabilities",
  summary: "The signed-in User's name, photo and application-wide capabilities, for the app shell.",
  tags: ["session"],
  responses: {
    200: {
      description: "The current User's capabilities.",
      content: { "application/json": { schema: CurrentCapabilitiesSchema } }
    },
    401: errorResponses[401]
  }
})

/** Fresh actor facts; clients use it after a 401 or account-status event to re-establish identity. */
export const currentActorRouter = createRouter()
  .openapi(getCurrentActor, async (c) => {
    const { authorization, impersonatedBy } = await c.var.resolveRequest()
    const actor = authorization.requirePermission({ action: "app.access" })
    return c.json({ userId: actor.userId, isAdmin: actor.isAdmin, impersonatedBy }, 200)
  })
  .openapi(getCurrentCapabilities, async (c) => {
    const { authorization } = await c.var.resolveRequest()
    const actor = authorization.requirePermission({ action: "app.access" })
    const [profile] = await c.var.database
      .select({ id: user.id, name: user.name, image: user.image })
      .from(user)
      .where(eq(user.id, actor.userId))
    if (!profile) return c.json({ code: "UNAUTHENTICATED" as const }, 401)
    const { locale } = await getUserPreferences(actor.userId, c.var.database)
    return c.json(
      {
        user: profile,
        locale,
        permissions: {
          admin: authorization.can({ action: "admin.access" }),
          administerUsers: authorization.can({ action: "user.administer" }),
          manageOrganisation: authorization.can({ action: "org.manage" }),
          administerEvents: authorization.can({ action: "event.administer" }),
          broadcastNotifications: authorization.can({ action: "notification.broadcast" })
        }
      },
      200
    )
  })

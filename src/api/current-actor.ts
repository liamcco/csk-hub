import { createRoute, z } from "@hono/zod-openapi"
import { createRouter, errorResponses } from "@/core/http"

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

/** Fresh actor facts; clients use it after a 401 or account-status event to re-establish identity. */
export const currentActorRouter = createRouter().openapi(getCurrentActor, async (c) => {
  const { authorization, impersonatedBy } = await c.var.resolveRequest()
  const actor = authorization.requirePermission({ action: "app.access" })
  return c.json({ userId: actor.userId, isAdmin: actor.isAdmin, impersonatedBy }, 200)
})

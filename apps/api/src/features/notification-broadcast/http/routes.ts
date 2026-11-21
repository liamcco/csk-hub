import { createRoute, z } from "@hono/zod-openapi"
import type { Context } from "hono"
import { type ApiEnv, createRouter, errorResponses } from "@/core/http"
import { notifyUsers, searchNotificationRecipients } from "../service"

function json<T extends z.ZodType>(description: string, schema: T) {
  return { description, content: { "application/json": { schema } } }
}

const counts = { accepted: z.int(), failed: z.int(), failureCategories: z.record(z.string(), z.int()) }

const BroadcastResultSchema = z
  .union([
    z.object({ success: z.literal(true), delivery: z.literal("queued"), queued: z.int() }),
    z.object({ success: z.literal(true), delivery: z.literal("sent"), ...counts }),
    z.object({
      success: z.literal(false),
      error: z.enum(["noRecipients", "noActiveSubscriptions", "deliveryFailed"])
    })
  ])
  .openapi("BroadcastResult", {
    description: "Queued for in-app delivery, or accepted by push providers; neither guarantees reception."
  })

const BroadcastErrorSchema = z.object({ code: z.enum(["MESSAGE_REQUIRED", "USER_REQUIRED"]) }).openapi("BroadcastError")

const routes = {
  sendBroadcast: createRoute({
    method: "post",
    path: "/broadcasts",
    operationId: "sendBroadcast",
    summary: "Sends an Admin broadcast to every active User, or to the selected ones. Admins only.",
    description:
      "Push goes out immediately in bulk. With real-time delivery configured, in-app feedback is also " +
      "queued as `push: false` activity and dispatched after the write commits.",
    tags: ["broadcasts"],
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: z
              .object({ message: z.string().max(500), userIds: z.array(z.string()).max(500).optional() })
              .openapi("Broadcast")
          }
        }
      }
    },
    responses: {
      200: json("How delivery went.", BroadcastResultSchema),
      400: json("No message, or an empty selection of Users.", BroadcastErrorSchema),
      401: errorResponses[401],
      403: errorResponses[403]
    }
  }),
  searchBroadcastRecipients: createRoute({
    method: "get",
    path: "/broadcasts/recipients",
    operationId: "searchBroadcastRecipients",
    summary: "Up to 25 active Users a broadcast can reach, by name or email. Admins only.",
    description: "`requiresPush` is true when only Users with an active push subscription can be reached.",
    tags: ["broadcasts"],
    request: { query: z.object({ search: z.string().max(200).optional() }) },
    responses: {
      200: json(
        "Recipients.",
        z
          .object({
            users: z.array(z.object({ id: z.string(), name: z.string(), email: z.string() })),
            requiresPush: z.boolean()
          })
          .openapi("BroadcastRecipients")
      ),
      400: errorResponses[400],
      401: errorResponses[401],
      403: errorResponses[403]
    }
  })
}

async function broadcaster(c: Context<ApiEnv>) {
  const { authorization } = await c.var.resolveRequest()
  authorization.requirePermission({ action: "notification.broadcast" })
}

/** Admin broadcasts, mounted under `/api/v1`. */
export const broadcastsRouter = createRouter()

broadcastsRouter.openapi(routes.sendBroadcast, async (c) => {
  await broadcaster(c)
  const { message, userIds } = c.req.valid("json")
  const trimmed = message.trim()
  if (!trimmed) return c.json({ code: "MESSAGE_REQUIRED" as const }, 400)
  if (userIds && userIds.length === 0) return c.json({ code: "USER_REQUIRED" as const }, 400)
  const context = { database: c.var.database, scheduleDelivery: c.var.scheduleDelivery }
  return c.json(await notifyUsers(context, trimmed, userIds), 200)
})

broadcastsRouter.openapi(routes.searchBroadcastRecipients, async (c) => {
  await broadcaster(c)
  return c.json(await searchNotificationRecipients(c.var.database, c.req.valid("query").search ?? ""), 200)
})

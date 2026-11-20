import { createRoute, z } from "@hono/zod-openapi"
import type { Context } from "hono"
import { type ApiEnv, createRouter, errorResponses } from "@/core/http"
import { locales } from "@/core/i18n/locales"
import { logger } from "@/core/logging"
import { hasActiveSubscription, sendToUser, subscribe, unsubscribe } from "@/core/notifications"
import { InvalidNotificationSubscriptionError } from "@/core/notifications/subscription-validation"
import { updateUserPreferences } from "@/core/preferences"
import { getErrorCode, getErrorName, getErrorStatus } from "@/shared/errors"
import { validationMessageIds } from "@/shared/schemas"
import { activationSchema } from "../activation/schemas"

function json<T extends z.ZodType>(description: string, schema: T) {
  return { description, content: { "application/json": { schema } } }
}

function body<T extends z.ZodType>(schema: T) {
  return { body: { required: true, content: { "application/json": { schema } } } }
}

const noContent = (description: string) => ({ description })

const SubscriptionErrorSchema = z
  .object({
    code: z.enum(["INVALID_SUBSCRIPTION"]).openapi({
      description: "The endpoint or keys are not a supported browser push subscription."
    })
  })
  .openapi("PushSubscriptionError")

const ActivationErrorSchema = z
  .object({
    code: z
      .enum([
        "PASSWORD_REQUIRED",
        "PASSWORD_TOO_SHORT",
        "CONFIRM_PASSWORD_REQUIRED",
        "PASSWORDS_MISMATCH",
        "INVALID_LINK"
      ])
      .openapi({ description: "Why activation failed. Tolerate unknown codes." })
  })
  .openapi("ActivationError")

const EndpointSchema = z.object({ endpoint: z.string().max(2048) }).openapi("PushEndpoint")

const PushSubscriptionSchema = z
  .object({
    endpoint: z.string().max(2048),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({ p256dh: z.string().max(256), auth: z.string().max(256) })
  })
  .openapi("PushSubscription", { description: "A browser's `PushSubscription.toJSON()`." })

const deliveryCounts = {
  accepted: z.int(),
  failed: z.int(),
  failureCategories: z.record(z.string(), z.int())
}

const DeliveryResultSchema = z
  .discriminatedUnion("success", [
    z.object({ success: z.literal(true), ...deliveryCounts }),
    z.object({
      success: z.literal(false),
      error: z.enum(["noActiveSubscriptions", "noRecipients", "deliveryFailed"]),
      ...deliveryCounts
    })
  ])
  .openapi("PushDeliveryResult")

const routes = {
  updateLocalePreference: createRoute({
    method: "put",
    path: "/account/locale",
    operationId: "updateLocalePreference",
    summary: "Saves the caller's locale preference, keeping their other preferences.",
    tags: ["account"],
    request: body(z.object({ locale: z.enum(locales) }).openapi("LocalePreference")),
    responses: { 204: noContent("Saved."), 400: errorResponses[400], 401: errorResponses[401] }
  }),
  getPushSubscriptionStatus: createRoute({
    method: "post",
    path: "/account/push-subscriptions/status",
    operationId: "getPushSubscriptionStatus",
    summary: "Whether this browser's push endpoint is bound to the caller.",
    description:
      "A read sent as POST so the endpoint, a bearer-like secret, stays out of URLs and logs. Another User's " +
      "binding reads as `unbound`; an unsupported endpoint reads as `unsupported` so the browser can drop it.",
    tags: ["account"],
    request: body(EndpointSchema),
    responses: {
      200: json(
        "The binding.",
        z.object({ binding: z.enum(["bound", "unbound", "unsupported"]) }).openapi("PushSubscriptionStatus")
      ),
      400: errorResponses[400],
      401: errorResponses[401]
    }
  }),
  registerPushSubscription: createRoute({
    method: "post",
    path: "/account/push-subscriptions",
    operationId: "registerPushSubscription",
    summary: "Binds a browser push subscription to the caller, taking it over from any earlier owner.",
    tags: ["account"],
    request: body(PushSubscriptionSchema),
    responses: {
      204: noContent("Bound."),
      400: json("Not a supported push subscription, or the request failed validation.", SubscriptionErrorSchema),
      401: errorResponses[401]
    }
  }),
  removePushSubscription: createRoute({
    method: "post",
    path: "/account/push-subscriptions/remove",
    operationId: "removePushSubscription",
    summary: "Removes the caller's own binding for an endpoint, as on disabling notifications or signing out.",
    tags: ["account"],
    request: body(EndpointSchema),
    responses: {
      200: json("Whether a binding of the caller's was removed.", z.object({ removed: z.boolean() })),
      400: json("Not a supported push endpoint, or the request failed validation.", SubscriptionErrorSchema),
      401: errorResponses[401]
    }
  }),
  sendTestPushNotification: createRoute({
    method: "post",
    path: "/account/push-subscriptions/test",
    operationId: "sendTestPushNotification",
    summary: "Sends a test notification to the caller's own active subscriptions.",
    tags: ["account"],
    request: body(z.object({ message: z.string().trim().min(1).max(500) })),
    responses: {
      200: json("How the push providers answered.", DeliveryResultSchema),
      400: errorResponses[400],
      401: errorResponses[401]
    }
  }),
  activateAccount: createRoute({
    method: "post",
    path: "/account/activation",
    operationId: "activateAccount",
    summary: "Sets an invited User's first password from the session their magic link opened.",
    tags: ["account"],
    request: body(z.object({ password: z.string(), confirmPassword: z.string() }).openapi("Activation")),
    responses: {
      204: noContent("Activated."),
      400: json("The passwords break the password policy.", ActivationErrorSchema),
      401: json("`INVALID_LINK`: no valid magic-link session.", ActivationErrorSchema)
    }
  })
}

async function callerId(c: Context<ApiEnv>) {
  const { authorization } = await c.var.resolveRequest()
  return authorization.requirePermission({ action: "app.access" }).userId
}

function invalidSubscription(c: Context) {
  return c.json({ code: "INVALID_SUBSCRIPTION" as const }, 400)
}

function activationFailure(issues: z.core.$ZodIssue[]) {
  if (issues.some((issue) => issue.message === validationMessageIds.passwordsMismatch)) return "PASSWORDS_MISMATCH"
  const issue = issues[0]
  const field = issue?.path[0]
  if (issue?.message === validationMessageIds.required) {
    return field === "confirmPassword" ? "CONFIRM_PASSWORD_REQUIRED" : "PASSWORD_REQUIRED"
  }
  return "PASSWORD_TOO_SHORT"
}

/** Account settings and activation, mounted under `/api/v1`. */
export const accountRouter = createRouter()

accountRouter.openapi(routes.updateLocalePreference, async (c) => {
  const { locale } = c.req.valid("json")
  const userId = await callerId(c)
  await updateUserPreferences(userId, { locale }, c.var.database)
  return c.body(null, 204)
})

accountRouter.openapi(routes.getPushSubscriptionStatus, async (c) => {
  const userId = await callerId(c)
  try {
    const bound = await hasActiveSubscription(userId, c.req.valid("json").endpoint, c.var.database)
    return c.json({ binding: bound ? ("bound" as const) : ("unbound" as const) }, 200)
  } catch (error) {
    if (error instanceof InvalidNotificationSubscriptionError) return c.json({ binding: "unsupported" as const }, 200)
    throw error
  }
})

accountRouter.openapi(routes.registerPushSubscription, async (c) => {
  const userId = await callerId(c)
  try {
    await subscribe(userId, c.req.valid("json"), c.var.database)
  } catch (error) {
    if (error instanceof InvalidNotificationSubscriptionError) return invalidSubscription(c)
    throw error
  }
  return c.body(null, 204)
})

accountRouter.openapi(routes.removePushSubscription, async (c) => {
  const userId = await callerId(c)
  try {
    const removed = await unsubscribe(userId, c.req.valid("json").endpoint, c.var.database)
    return c.json({ removed }, 200)
  } catch (error) {
    if (error instanceof InvalidNotificationSubscriptionError) return invalidSubscription(c)
    throw error
  }
})

accountRouter.openapi(routes.sendTestPushNotification, async (c) => {
  const userId = await callerId(c)
  return c.json(await sendToUser(userId, { body: c.req.valid("json").message }, c.var.database), 200)
})

accountRouter.openapi(routes.activateAccount, async (c) => {
  const input = activationSchema.safeParse(c.req.valid("json"))
  if (!input.success) return c.json({ code: activationFailure(input.error.issues) }, 400)
  try {
    await c.var.authApi.setPassword({ headers: c.req.raw.headers, body: { newPassword: input.data.password } })
  } catch (error) {
    const status = getErrorStatus(error)
    const code = getErrorCode(error)
    if (status === 401 || code === "INVALID_TOKEN" || code === "SESSION_EXPIRED") {
      return c.json({ code: "INVALID_LINK" as const }, 401)
    }
    logger.error("auth.activation.failed", { errorCode: code, errorName: getErrorName(error), status })
    throw error
  }
  return c.body(null, 204)
})

import { logger } from "@csk-hub/shared/core/logging"
import { OpenAPIHono } from "@hono/zod-openapi"
import type { Context } from "hono"
import { AuthorizationDeniedError } from "@/core/authz/authorization"
import type { ApiErrorCode } from "./errors"
import type { ApiEnv } from "./request-context"

/**
 * A router for one feature's operations. Features define routes with `createRoute`, register them
 * with `router.openapi(route, handler)` and export the router; the API composition root mounts it.
 * Invalid input is answered with `VALIDATION_FAILED` before the handler runs.
 */
export function createRouter() {
  return new OpenAPIHono<ApiEnv>({
    defaultHook: (result, c) => {
      if (result.success) return
      return c.json(
        {
          code: "VALIDATION_FAILED" as const,
          issues: result.error.issues.map((issue) => ({
            path: issue.path.filter((segment) => typeof segment !== "symbol"),
            code: issue.message
          }))
        },
        400
      )
    }
  })
}

export type ApiRouter = ReturnType<typeof createRouter>

/** Answers with a stable error code; messages never cross the API boundary. */
export function apiError(c: Context, status: 400 | 401 | 403 | 404 | 500, code: ApiErrorCode) {
  return c.json({ code }, status)
}

/**
 * Maps thrown errors to stable codes. Authorization denials disclose neither resource existence
 * nor actor details: no actor is 401, anything else 403. Features map denials to 404 themselves
 * where existence must stay hidden.
 */
export function handleApiError(error: Error, c: Context) {
  if (error instanceof AuthorizationDeniedError) {
    return error.actor ? apiError(c, 403, "FORBIDDEN") : apiError(c, 401, "UNAUTHENTICATED")
  }
  logger.error("api.unhandled_error", { path: c.req.path, error: error.message })
  return apiError(c, 500, "INTERNAL")
}

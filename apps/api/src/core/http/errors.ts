import { z } from "@hono/zod-openapi"

/**
 * Stable, machine-readable failure codes. Clients branch and translate on `code`; messages are
 * never part of the contract. Add codes freely; never rename or repurpose one.
 */
export const apiErrorCodes = ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "VALIDATION_FAILED", "INTERNAL"] as const

export type ApiErrorCode = (typeof apiErrorCodes)[number]

export const ApiErrorSchema = z
  .object({
    code: z.enum(apiErrorCodes).openapi({ description: "Stable error code. Clients must tolerate unknown codes." })
  })
  .openapi("ApiError")

export const ValidationErrorSchema = z
  .object({
    code: z.literal("VALIDATION_FAILED"),
    issues: z.array(
      z.object({
        path: z.array(z.union([z.string(), z.number()])),
        code: z.string().openapi({ description: "Zod issue code or a validation message ID." })
      })
    )
  })
  .openapi("ValidationError")

function errorResponse(description: string) {
  return { description, content: { "application/json": { schema: ApiErrorSchema } } }
}

/**
 * Shared failure documentation for `createRoute({ responses })`, so every route describes its
 * failures with the same shapes: `responses: { 200: ..., 401: errorResponses[401] }`.
 */
export const errorResponses = {
  400: {
    description: "The request failed validation.",
    content: { "application/json": { schema: ValidationErrorSchema } }
  },
  401: errorResponse("No active signed-in User."),
  403: errorResponse("The current User may not perform this operation."),
  404: errorResponse("The resource does not exist or is not visible to the current User.")
}

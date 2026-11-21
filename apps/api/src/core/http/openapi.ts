import { z } from "@hono/zod-openapi"

/** Documents a JSON response for `createRoute({ responses })`. */
export function jsonResponse<T extends z.ZodType>(description: string, schema: T) {
  return { description, content: { "application/json": { schema } } }
}

/** Documents a required JSON request body for `createRoute({ request })`. */
export function jsonBody<T extends z.ZodType>(schema: T) {
  return { body: { required: true, content: { "application/json": { schema } } } }
}

/** An ISO 8601 date-time string, e.g. `2026-05-01T18:00:00.000Z`. */
export function instant() {
  return z.string().openapi({ format: "date-time" })
}

/**
 * Turns a feature's kebab-case failure kind into its wire code: `group-name-taken` travels as
 * `GROUP_NAME_TAKEN`. Web clients map the code back to the kind to translate it.
 */
export function domainErrorCode(kind: string) {
  return kind.toUpperCase().replaceAll("-", "_") as Uppercase<string>
}

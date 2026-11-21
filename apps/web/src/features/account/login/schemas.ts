import { passwordSchema, validationMessageIds } from "@csk-hub/shared/shared/schemas"
import z from "zod"

export const loginSchema = z.object({
  identifier: z.string({ error: validationMessageIds.required }).trim().min(1, validationMessageIds.required),
  password: passwordSchema,
  rememberMe: z.boolean()
})

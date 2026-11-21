import { normalizedEmailSchema, passwordSchema, validationMessageIds } from "@csk-hub/shared/shared/schemas"
import { z } from "zod"

export const passwordResetRequestSchema = z.object({
  email: normalizedEmailSchema
})

export const passwordResetSchema = z
  .object({
    email: normalizedEmailSchema,
    password: passwordSchema,
    confirmPassword: passwordSchema
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: validationMessageIds.passwordsMismatch,
    path: ["confirmPassword"]
  })

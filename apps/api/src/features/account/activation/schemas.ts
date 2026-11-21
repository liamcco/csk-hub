import { passwordSchema, validationMessageIds } from "@csk-hub/shared/shared/schemas"
import { z } from "zod"

export const activationSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: passwordSchema
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: validationMessageIds.passwordsMismatch,
    path: ["confirmPassword"]
  })

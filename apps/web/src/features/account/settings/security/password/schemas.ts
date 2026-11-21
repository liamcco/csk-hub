import { passwordSchema, validationMessageIds } from "@csk-hub/shared/shared/schemas"
import { z } from "zod"

export const changePasswordSchema = z
  .object({
    currentPassword: z.string({ error: validationMessageIds.required }).min(1, validationMessageIds.required),
    newPassword: passwordSchema,
    confirmation: passwordSchema
  })
  .refine((value) => value.newPassword === value.confirmation, {
    message: validationMessageIds.passwordsMismatch,
    path: ["confirmation"]
  })

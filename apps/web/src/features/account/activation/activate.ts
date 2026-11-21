import { activateAccount as activate } from "@csk-hub/contract/client"
import { ROUTES } from "@csk-hub/shared/core/navigation/site"
import { browserApiClient } from "@/core/api-client/browser"
import { errorCode } from "@/core/api-client/result"

type ActivationFailure =
  | "password-required"
  | "password-too-short"
  | "confirm-password-required"
  | "passwords-mismatch"
  | "invalid-link"
  | "unavailable"

export type ActivationState =
  | { status: "idle" }
  | { status: "error"; kind: ActivationFailure }
  | { status: "success"; redirectTo: string }

const FAILURES: Record<string, ActivationFailure> = {
  PASSWORD_REQUIRED: "password-required",
  PASSWORD_TOO_SHORT: "password-too-short",
  CONFIRM_PASSWORD_REQUIRED: "confirm-password-required",
  PASSWORDS_MISMATCH: "passwords-mismatch",
  INVALID_LINK: "invalid-link"
}

function text(formData: FormData, name: string) {
  const value = formData.get(name)
  return typeof value === "string" ? value : ""
}

/** Sets the invited User's first password through the API, from the session their magic link opened. */
export async function activateAccount(_state: ActivationState, formData: FormData): Promise<ActivationState> {
  try {
    const { error, response } = await activate({
      client: browserApiClient,
      body: { password: text(formData, "password"), confirmPassword: text(formData, "confirmPassword") }
    })
    if (response?.ok) return { status: "success", redirectTo: ROUTES.home }
    return { status: "error", kind: FAILURES[errorCode(error) ?? ""] ?? "unavailable" }
  } catch {
    return { status: "error", kind: "unavailable" }
  }
}

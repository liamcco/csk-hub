/** Why an admin command on a User failed; each is a `Members.memberActionErrors` message. */
export type UserCommandError =
  | "unavailable"
  | "userNotFound"
  | "alreadyActive"
  | "alreadyInactive"
  | "cannotDeactivateSelf"
  | "cannotEraseSelf"
  | "cannotChangeOwnRole"
  | "cannotDeactivateLastAdmin"
  | "cannotEraseLastAdmin"
  | "cannotDemoteLastAdmin"
  | "deactivateFirst"
  | "confirmationMismatch"
  | "alreadyActivated"

export type UserCommandState =
  | { status: "idle" }
  | { status: "error"; error: UserCommandError }
  | { status: "success"; action: "activate" | "deactivate" | "delete" | "invite" | "role" }

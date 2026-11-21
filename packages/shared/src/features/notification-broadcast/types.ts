import type { NotificationDeliveryDiagnostics } from "../../core/notifications/types"

/** A broadcast is queued for later delivery or accepted by push providers; neither guarantees reception. */
export type BroadcastDelivery =
  | { success: true; delivery: "queued"; queued: number }
  | ({ success: true; delivery: "sent" } & NotificationDeliveryDiagnostics)
  | { success: false; error: "noRecipients" | "noActiveSubscriptions" | "deliveryFailed" }

/** What the broadcast screen shows: how delivery went, or why nothing was sent. */
export type BroadcastResult = BroadcastDelivery | { success: false; error: "messageRequired" | "userRequired" }

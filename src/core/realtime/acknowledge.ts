import "server-only"

import { and, eq, isNull } from "drizzle-orm"
import type { Database } from "@/core/db"
import { activityDelivery } from "@/core/db/schema/activity"
import type { ActivitySession } from "./access"
import { type ActivityDeliveryPolicy, isDeliveryAllowed } from "./delivery-access"

/**
 * A foreground toast acknowledgement cancels push, without marking the Conversation read.
 * False when the delivery is not the User's or no longer deliverable to them.
 */
export async function acknowledgeActivity(
  policy: ActivityDeliveryPolicy,
  database: Database,
  identity: ActivitySession,
  id: string
) {
  const [delivery] = await database
    .select()
    .from(activityDelivery)
    .where(and(eq(activityDelivery.id, id), eq(activityDelivery.userId, identity.userId)))
  if (!delivery || !(await isDeliveryAllowed(policy, delivery))) return false
  await database
    .update(activityDelivery)
    .set({ acknowledgedAt: new Date() })
    .where(
      and(
        eq(activityDelivery.id, delivery.id),
        eq(activityDelivery.userId, identity.userId),
        isNull(activityDelivery.acknowledgedAt)
      )
    )
  return true
}

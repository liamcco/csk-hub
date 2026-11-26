import { logger } from "@csk-hub/shared/core/logging"
import { and, count, eq, inArray, isNull, lt, lte, or, type SQL, sql } from "drizzle-orm"
import { env } from "@/core/config/env"
import { db } from "@/core/db"
import { activityDelivery } from "@/core/db/schema/activity"
import { addDays, addMilliseconds, jsonText, millisecondsBetween, now } from "@/core/db/sql"
import { sendToUser } from "@/core/notifications"
import { type ActivityBroker, connectActivityBroker, publishActivity } from "@/core/realtime/broker"
import { type ActivityDeliveryPolicy, type Delivery, isDeliveryAllowed } from "./delivery-access"

const DISPATCH_CONCURRENCY = 5

/**
 * Claims a delivery may take before a failing Web Push gives up. Retries back off from one second
 * to a minute, so the bound is reached about seven minutes after the first attempt.
 */
export const MAX_DELIVERY_ATTEMPTS = 12

/** How long a claim owns its deliveries before another worker may take them over. */
const LEASE_MS = 90_000

/** Locks due, unleased deliveries other workers have not locked, and leases them in the same transaction. */
async function claimDeliveries(limit: number) {
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: activityDelivery.id })
      .from(activityDelivery)
      .where(
        and(
          or(isNull(activityDelivery.leaseUntil), lt(activityDelivery.leaseUntil, now())),
          or(
            and(isNull(activityDelivery.publishedAt), lte(activityDelivery.publishAfter, now())),
            and(
              isNull(activityDelivery.pushCompletedAt),
              isNull(activityDelivery.acknowledgedAt),
              lte(activityDelivery.pushAfter, now())
            )
          )
        )
      )
      .orderBy(
        sql`case when ${jsonText(activityDelivery.change, "conversationId")} is not null then 0 else 1 end`,
        activityDelivery.createdAt
      )
      .limit(limit)
      .for("update", { skipLocked: true })
    if (!candidates.length) return []
    return tx
      .update(activityDelivery)
      .set({
        leaseToken: crypto.randomUUID(),
        leaseUntil: addMilliseconds(now(), LEASE_MS),
        attempts: sql`${activityDelivery.attempts} + 1`
      })
      .where(
        inArray(
          activityDelivery.id,
          candidates.map(({ id }) => id)
        )
      )
      .returning()
  })
}

async function dispatchOne(
  policy: ActivityDeliveryPolicy,
  delivery: Delivery,
  publish: (userId: string, deliveryId: string) => Promise<void>
) {
  const owned = and(eq(activityDelivery.id, delivery.id), eq(activityDelivery.leaseToken, delivery.leaseToken ?? ""))
  const updates: {
    [K in keyof typeof activityDelivery.$inferInsert]?: (typeof activityDelivery.$inferInsert)[K] | SQL
  } = { leaseUntil: null, leaseToken: null }
  const retryMs = Math.min(60_000, 1_000 * 2 ** Math.min(delivery.attempts, 6))
  const retryAt = addMilliseconds(now(), retryMs)
  try {
    if (!(await isDeliveryAllowed(policy, delivery))) {
      updates.publishedAt = now()
      updates.pushCompletedAt = now()
      return
    }
    if (!delivery.publishedAt) {
      try {
        await publish(delivery.userId, delivery.id)
        updates.publishedAt = now()
      } catch {
        updates.publishAfter = retryAt
        logger.warn("realtime.publish.retry", { deliveryId: delivery.id })
      }
    }
    if (delivery.pushAfter && !delivery.pushCompletedAt) {
      // Re-read acknowledgement after publishing: a foreground browser may have handled it.
      const [current] = await db
        .select()
        .from(activityDelivery)
        .where(and(owned, lte(activityDelivery.pushAfter, now())))
      if (!current) return
      if (
        current.acknowledgedAt ||
        (await policy.isAlreadyOpened(current)) ||
        !(await isDeliveryAllowed(policy, current))
      ) {
        updates.pushCompletedAt = now()
      } else if (current.body) {
        const result = await sendToUser(current.userId, {
          body: current.body,
          url: current.href ?? undefined,
          tag: current.id
        })
        if (result.success || result.error === "noActiveSubscriptions") updates.pushCompletedAt = now()
        else if (delivery.attempts >= MAX_DELIVERY_ATTEMPTS) {
          updates.pushCompletedAt = now()
          logger.error("realtime.push.abandoned", { deliveryId: delivery.id, attempts: delivery.attempts })
        } else {
          updates.pushAfter = retryAt
          logger.warn("realtime.push.retry", { deliveryId: delivery.id, attempts: delivery.attempts })
        }
      } else {
        updates.pushCompletedAt = now()
      }
    }
  } catch {
    updates.publishAfter = retryAt
    if (delivery.pushAfter && delivery.attempts >= MAX_DELIVERY_ATTEMPTS) {
      updates.pushCompletedAt = now()
      logger.error("realtime.push.abandoned", { deliveryId: delivery.id, attempts: delivery.attempts })
    } else if (delivery.pushAfter) updates.pushAfter = retryAt
    logger.error("realtime.delivery.retry", { deliveryId: delivery.id })
  } finally {
    await db.update(activityDelivery).set(updates).where(owned)
  }
}

/** Claims concurrent waves atomically, prioritizing Conversation changes; abort finishes only the current wave. */
export async function dispatchActivity(policy: ActivityDeliveryPolicy, signal?: AbortSignal) {
  if (!env.REDIS_URL) return { processed: 0 }
  let processed = 0
  let broker: Promise<ActivityBroker> | undefined
  const deadline = Date.now() + 20_000
  try {
    while (!signal?.aborted && processed < 50 && Date.now() < deadline) {
      const deliveries = await claimDeliveries(Math.min(DISPATCH_CONCURRENCY, 50 - processed))
      if (!deliveries.length) break
      const attempts = await Promise.allSettled(
        deliveries.map((delivery) =>
          dispatchOne(policy, delivery, async (userId, deliveryId) => {
            broker ??= connectActivityBroker()
            await publishActivity(await broker, userId, deliveryId)
          })
        )
      )
      const failure = attempts.find((attempt) => attempt.status === "rejected")
      if (failure?.status === "rejected") throw failure.reason
      processed += deliveries.length
    }
  } finally {
    const connection = await broker?.catch(() => undefined)
    if (connection?.isOpen) connection.destroy()
  }
  return { processed }
}

/**
 * Milliseconds until the next publication, push, or abandoned lease is eligible, measured
 * against the database clock. Null means no work remains. Acknowledged push is not pending.
 */
export async function nextActivityDelay(): Promise<number | null> {
  const publishAt = sql`case when ${activityDelivery.publishedAt} is null then ${activityDelivery.publishAfter} end`
  const pushAt = sql`case when ${activityDelivery.pushCompletedAt} is null and ${activityDelivery.acknowledgedAt} is null
    then ${activityDelivery.pushAfter} end`
  const leaseFreeAt = sql`coalesce(${activityDelivery.leaseUntil}, ${now()})`
  // MariaDB's least and greatest return null for any null argument, where PostgreSQL's skip nulls;
  // coalescing each argument with the other gives PostgreSQL's answer on both.
  const dueAt = sql`least(coalesce(${publishAt}, ${pushAt}), coalesce(${pushAt}, ${publishAt}))`
  const eligibleAt = sql`greatest(${leaseFreeAt}, coalesce(${dueAt}, ${leaseFreeAt}))`
  const [row] = await db
    .select({ delay: millisecondsBetween(now(), sql`min(${eligibleAt})`) })
    .from(activityDelivery)
    .where(
      or(
        isNull(activityDelivery.publishedAt),
        and(
          isNull(activityDelivery.pushCompletedAt),
          isNull(activityDelivery.acknowledgedAt),
          sql`${activityDelivery.pushAfter} is not null`
        )
      )
    )
  return row?.delay === null || row?.delay === undefined ? null : Math.max(0, Number(row.delay))
}

/** Records still awaiting publication or a due push, and how long the oldest has waited. */
export async function pendingActivityStats() {
  const [row] = await db
    .select({
      pending: count(),
      oldestAgeMs: millisecondsBetween(sql`min(${activityDelivery.createdAt})`, now())
    })
    .from(activityDelivery)
    .where(
      or(
        isNull(activityDelivery.publishedAt),
        and(
          sql`${activityDelivery.pushAfter} is not null`,
          isNull(activityDelivery.pushCompletedAt),
          isNull(activityDelivery.acknowledgedAt)
        )
      )
    )
  return { pending: Number(row?.pending ?? 0), oldestAgeMs: Math.max(0, Number(row?.oldestAgeMs ?? 0)) }
}

/** Removes deliveries older than seven days and reports expired unfinished work. */
export async function pruneActivity() {
  const expired = await db
    .delete(activityDelivery)
    .where(lt(activityDelivery.createdAt, addDays(now(), -7)))
    .returning({
      publishedAt: activityDelivery.publishedAt,
      pushAfter: activityDelivery.pushAfter,
      pushCompletedAt: activityDelivery.pushCompletedAt,
      acknowledgedAt: activityDelivery.acknowledgedAt
    })
  const removed = expired.length
  const unfinished = expired.filter(
    (row) => row.publishedAt === null || (row.pushAfter !== null && !row.pushCompletedAt && !row.acknowledgedAt)
  ).length
  if (unfinished) logger.warn("realtime.delivery.expired", { count: unfinished })
  if (removed) logger.info("realtime.retention.pruned", { count: removed })
}

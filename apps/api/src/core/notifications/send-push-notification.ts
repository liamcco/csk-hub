import https from "node:https"
import { app } from "@csk-hub/shared/core/config/app"
import { parseSafeInternalPath } from "@csk-hub/shared/core/navigation/navigation-utils"
import type {
  NotificationDeliveryDiagnostics,
  NotificationDeliveryFailureCategory,
  NotificationDeliveryResult,
  PushNotification
} from "@csk-hub/shared/core/notifications/types"
import { and, eq, getTableColumns, inArray, isNull, or, sql } from "drizzle-orm"
import webpush from "web-push"
import { env } from "@/core/config/env"
import { type Database, db } from "@/core/db"
import { user } from "@/core/db/schema/auth"
import { pushSubscription } from "@/core/db/schema/notifications"
import { InvalidNotificationSubscriptionError, parseNotificationSubscription } from "./subscription-validation"

const DEFAULT_CONCURRENCY = 5
const SOCKET_IDLE_TIMEOUT_MS = 7_000
const REQUEST_DEADLINE_MS = 10_000
const BOOKKEEPING_DEADLINE_MS = 2_000

webpush.setVapidDetails(`mailto:${env.CONTACT_EMAIL}`, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)

class PushDeliveryDeadlineError extends Error {
  constructor() {
    super("Push delivery deadline exceeded")
    this.name = "PushDeliveryDeadlineError"
  }
}

type StoredSubscription = typeof pushSubscription.$inferSelect

async function withDeadline(operation: Promise<unknown>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new PushDeliveryDeadlineError()), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

function failureCategory(error: unknown): NotificationDeliveryFailureCategory {
  if (error instanceof InvalidNotificationSubscriptionError) return "invalidSubscription"
  if (error instanceof PushDeliveryDeadlineError || (error instanceof Error && error.message === "Socket timeout"))
    return "timeout"
  const statusCode = error instanceof webpush.WebPushError ? error.statusCode : undefined
  if (statusCode === 404 || statusCode === 410) return "subscriptionGone"
  return statusCode === undefined ? "transport" : "providerRejected"
}

async function deliverOne(stored: StoredSubscription, payload: string, database: Database) {
  const agent = new https.Agent({ keepAlive: false })
  let category: NotificationDeliveryFailureCategory | undefined
  try {
    const subscription = parseNotificationSubscription({
      endpoint: stored.endpoint,
      keys: { p256dh: stored.p256dh, auth: stored.auth }
    })
    await withDeadline(
      webpush.sendNotification({ endpoint: subscription.endpoint, keys: subscription.keys }, payload, {
        timeout: SOCKET_IDLE_TIMEOUT_MS,
        agent
      }),
      REQUEST_DEADLINE_MS
    )
  } catch (error) {
    category = failureCategory(error)
  } finally {
    // Closing this attempt's sockets cancels transport when the overall deadline expires.
    agent.destroy()
  }

  let bookkeepingFailed = false
  try {
    const update = category === undefined ? recordSuccess(stored, database) : recordFailure(stored, category, database)
    await withDeadline(update, BOOKKEEPING_DEADLINE_MS)
  } catch {
    bookkeepingFailed = true
  }
  return { accepted: category === undefined, category, bookkeepingFailed }
}

/** A notification may only lead into this app, so its url is sent as a normalized internal path. */
function toPayload({ body, url, tag }: PushNotification) {
  const path = url === undefined ? undefined : parseSafeInternalPath(url)
  if (url !== undefined && path === undefined) {
    throw new Error(`A push notification url must be a same-origin path, not ${url}`)
  }
  return JSON.stringify({ title: app.name, body, url: path, tag })
}

async function sendToSubscriptions(
  subscriptions: StoredSubscription[],
  notification: PushNotification,
  database: Database
): Promise<NotificationDeliveryResult> {
  const payload = toPayload(notification)
  if (subscriptions.length === 0) {
    return { success: false, error: "noActiveSubscriptions", accepted: 0, failed: 0, failureCategories: {} }
  }
  let nextIndex = 0
  let accepted = 0
  const failureCategories: NotificationDeliveryDiagnostics["failureCategories"] = {}
  const countFailure = (category: NotificationDeliveryFailureCategory) => {
    failureCategories[category] = (failureCategories[category] ?? 0) + 1
  }
  await Promise.all(
    Array.from({ length: Math.min(DEFAULT_CONCURRENCY, subscriptions.length) }, async () => {
      while (nextIndex < subscriptions.length) {
        const attempt = await deliverOne(subscriptions[nextIndex++], payload, database)
        if (attempt.accepted) accepted += 1
        if (attempt.category) countFailure(attempt.category)
        if (attempt.bookkeepingFailed) countFailure("bookkeeping")
      }
    })
  )
  const diagnostics = { accepted, failed: subscriptions.length - accepted, failureCategories }
  if (Object.keys(failureCategories).length > 0) console.error("[push:delivery]", diagnostics)
  return accepted > 0 ? { success: true, ...diagnostics } : { success: false, error: "deliveryFailed", ...diagnostics }
}

async function recordFailure(
  stored: StoredSubscription,
  category: NotificationDeliveryFailureCategory,
  database: Database
) {
  const disabledReasons: Partial<Record<NotificationDeliveryFailureCategory, string>> = {
    invalidSubscription: "Stored push subscription failed validation",
    subscriptionGone: "Push provider returned HTTP 404 or 410"
  }
  const disabledReason = disabledReasons[category] ?? null
  const permanentlyInvalid = disabledReason !== null
  const now = new Date()

  await database
    .update(pushSubscription)
    .set({
      status: permanentlyInvalid ? "disabled" : "active",
      lastFailureAt: now,
      failureCount: sql`${pushSubscription.failureCount} + 1`,
      disabledAt: permanentlyInvalid ? now : null,
      disabledReason,
      updatedAt: now
    })
    .where(eq(pushSubscription.id, stored.id))
}

async function recordSuccess(stored: StoredSubscription, database: Database) {
  const now = new Date()
  await database
    .update(pushSubscription)
    .set({ lastSuccessAt: now, lastSeenAt: now, failureCount: 0, updatedAt: now })
    .where(eq(pushSubscription.id, stored.id))
}

/** Delivers a notification to every active push subscription belonging to one User. */
export async function sendToUser(userId: string, notification: PushNotification, database: Database = db) {
  return sendToUsers([userId], notification, database)
}

/**
 * Delivers a notification to active subscriptions for the selected Users.
 * A successful result means at least one subscription accepted the delivery.
 */
export async function sendToUsers(
  userIds: string[],
  notification: PushNotification,
  database: Database = db
): Promise<NotificationDeliveryResult> {
  if (userIds.length === 0) {
    return { success: false, error: "noRecipients", accepted: 0, failed: 0, failureCategories: {} }
  }
  return sendToSubscriptions(await listDeliverySubscriptions(database, userIds), notification, database)
}

/** Delivers a notification to every eligible active User's push subscriptions. */
export async function sendToAll(notification: PushNotification, database: Database = db) {
  return sendToSubscriptions(await listDeliverySubscriptions(database), notification, database)
}

function listDeliverySubscriptions(database: Database, userIds?: string[]) {
  return database
    .select(getTableColumns(pushSubscription))
    .from(pushSubscription)
    .innerJoin(user, eq(user.id, pushSubscription.userId))
    .where(
      and(
        eq(pushSubscription.status, "active"),
        or(eq(user.banned, false), isNull(user.banned)),
        userIds ? inArray(user.id, userIds) : undefined
      )
    )
}

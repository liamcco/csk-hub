import type { ActivityChange } from "@csk-hub/shared/core/realtime/events"
import { index, int, json, mysqlTable, text } from "drizzle-orm/mysql-core"
import { user } from "./auth"
import { currentTimestamp, key, timestamp, uuid, uuidPrimaryKey } from "./columns"

/** `../postgres/activity.ts` on MariaDB. */
export const activityDelivery = mysqlTable(
  "activity_delivery",
  {
    id: uuidPrimaryKey("id"),
    userId: key("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    change: json("change").$type<ActivityChange>().notNull(),
    body: text("body"),
    title: text("title"),
    href: text("href"),
    createdAt: timestamp("created_at").default(currentTimestamp).notNull(),
    publishedAt: timestamp("published_at"),
    publishAfter: timestamp("publish_after").default(currentTimestamp).notNull(),
    pushAfter: timestamp("push_after"),
    pushCompletedAt: timestamp("push_completed_at"),
    acknowledgedAt: timestamp("acknowledged_at"),
    attempts: int("attempts").default(0).notNull(),
    leaseUntil: timestamp("lease_until"),
    leaseToken: uuid("lease_token")
  },
  (table) => [
    index("activity_user_created_idx").on(table.userId, table.createdAt),
    index("activity_publish_pending_idx").on(table.publishedAt, table.publishAfter),
    index("activity_push_pending_idx").on(table.pushCompletedAt, table.pushAfter)
  ]
)

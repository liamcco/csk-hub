import { index, int, mysqlEnum, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core"
import { user } from "./auth"
import { currentTimestamp, key, timestamp } from "./columns"

/** `../postgres/notifications.ts` on MariaDB. */
export const pushSubscription = mysqlTable(
  "push_subscription",
  {
    id: key("id").primaryKey(),
    userId: key("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Push service URLs run to a few hundred characters; MariaDB keeps a unique index this long as a hash.
    endpoint: varchar("endpoint", { length: 2048 }).notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    expirationTime: timestamp("expiration_time"),
    userAgent: text("user_agent"),
    deviceLabel: text("device_label"),
    status: mysqlEnum("status", ["active", "disabled"]).default("active").notNull(),
    lastSeenAt: timestamp("last_seen_at").default(currentTimestamp).notNull(),
    lastSuccessAt: timestamp("last_success_at"),
    lastFailureAt: timestamp("last_failure_at"),
    failureCount: int("failure_count").default(0).notNull(),
    disabledAt: timestamp("disabled_at"),
    disabledReason: text("disabled_reason"),
    createdAt: timestamp("created_at").default(currentTimestamp).notNull(),
    updatedAt: timestamp("updated_at")
      .default(currentTimestamp)
      .$onUpdate(() => new Date())
      .notNull()
  },
  (table) => [
    uniqueIndex("push_subscription_endpoint_idx").on(table.endpoint),
    index("push_subscription_user_status_idx").on(table.userId, table.status),
    index("push_subscription_status_seen_idx").on(table.status, table.lastSeenAt)
  ]
)

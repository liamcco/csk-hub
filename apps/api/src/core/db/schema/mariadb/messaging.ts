import { sql } from "drizzle-orm"
import { check, index, int, mysqlEnum, mysqlTable, primaryKey, text, uniqueIndex } from "drizzle-orm/mysql-core"
import { user } from "./auth"
import { currentTimestamp, key, timestamp, uuid, uuidPrimaryKey } from "./columns"

// `../postgres/messaging.ts` on MariaDB; its comments explain the model.

export const conversation = mysqlTable("conversation", {
  id: uuidPrimaryKey("id"),
  kind: mysqlEnum("kind", ["direct", "group"]).notNull(),
  updatedAt: timestamp("updated_at").default(currentTimestamp).notNull(),
  nextMessageSequence: int("next_message_sequence").default(1).notNull()
})

export const directConversation = mysqlTable(
  "direct_conversation",
  {
    conversationId: uuid("conversation_id")
      .primaryKey()
      .references(() => conversation.id, { onDelete: "cascade" }),
    firstMemberId: key("first_member_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    secondMemberId: key("second_member_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" })
  },
  (table) => [
    uniqueIndex("directConversation_member_pair_unique").on(table.firstMemberId, table.secondMemberId),
    // Binary order, as PostgreSQL's C collation: code-unit order for the ASCII Better Auth IDs.
    check(
      "directConversation_member_pair_order_check",
      sql`${table.firstMemberId} COLLATE utf8mb4_bin < ${table.secondMemberId} COLLATE utf8mb4_bin`
    )
  ]
)

export const groupConversation = mysqlTable(
  "group_conversation",
  {
    conversationId: uuid("conversation_id")
      .primaryKey()
      .references(() => conversation.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdByUserId: key("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
    creationIdempotencyKey: key("creation_idempotency_key"),
    creationPayloadHash: text("creation_payload_hash"),
    createdAt: timestamp("created_at").default(currentTimestamp).notNull(),
    updatedAt: timestamp("updated_at").default(currentTimestamp).notNull()
  },
  (table) => [
    check("groupConversation_name_not_blank_check", sql`length(trim(${table.name})) > 0`),
    uniqueIndex("groupConversation_creator_creation_key_unique").on(
      table.createdByUserId,
      table.creationIdempotencyKey
    ),
    check(
      "groupConversation_creation_intent_check",
      sql`(${table.creationIdempotencyKey} IS NULL AND ${table.creationPayloadHash} IS NULL)
        OR (${table.creationIdempotencyKey} IS NOT NULL AND length(trim(${table.creationIdempotencyKey})) > 0
          AND ${table.creationPayloadHash} IS NOT NULL)`
    )
  ]
)

export const groupMembership = mysqlTable(
  "group_membership",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => groupConversation.conversationId, { onDelete: "cascade" }),
    userId: key("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at").default(currentTimestamp).notNull(),
    leftAt: timestamp("left_at"),
    historyVisibleThroughSequence: int("history_visible_through_sequence")
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.userId] }),
    index("groupMembership_userId_idx").on(table.userId),
    check(
      "groupMembership_departure_visibility_check",
      sql`(${table.leftAt} IS NULL) = (${table.historyVisibleThroughSequence} IS NULL)`
    ),
    check(
      "groupMembership_history_visible_through_sequence_check",
      sql`${table.historyVisibleThroughSequence} IS NULL OR ${table.historyVisibleThroughSequence} >= 0`
    )
  ]
)

export const conversationReadState = mysqlTable(
  "conversation_read_state",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    userId: key("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lastReadSequence: int("last_read_sequence").default(0).notNull()
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.userId] }),
    check("conversationReadState_last_read_sequence_check", sql`${table.lastReadSequence} >= 0`)
  ]
)

export const message = mysqlTable(
  "message",
  {
    id: uuidPrimaryKey("id"),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    sequence: int("sequence").notNull(),
    authorUserId: key("author_user_id").references(() => user.id, { onDelete: "set null" }),
    text: text("text").notNull(),
    idempotencyKey: key("idempotency_key").notNull(),
    sentAt: timestamp("sent_at").default(currentTimestamp).notNull()
  },
  (table) => [
    uniqueIndex("message_conversation_sequence_unique").on(table.conversationId, table.sequence),
    uniqueIndex("message_author_idempotency_key_unique").on(table.authorUserId, table.idempotencyKey),
    index("message_conversation_sent_at_idx").on(table.conversationId, table.sentAt),
    check("message_sequence_check", sql`${table.sequence} > 0`),
    check("message_text_not_blank_check", sql`length(trim(${table.text})) > 0`)
  ]
)

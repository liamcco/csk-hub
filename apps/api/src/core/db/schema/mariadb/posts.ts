import type { JSONContent } from "@tiptap/core"
import { sql } from "drizzle-orm"
import { check, index, json, mysqlTable, primaryKey, text } from "drizzle-orm/mysql-core"
import { user } from "./auth"
import { currentTimestamp, key, timestamp, uuid, uuidPrimaryKey } from "./columns"

// `../postgres/posts.ts` on MariaDB. PostgreSQL also derives `body_search`, a full-text index over
// the body's text nodes; nothing queries it yet, so MariaDB has no counterpart. A search feature
// would add one here (a generated column over `JSON_EXTRACT(body, '$**.text')` with a FULLTEXT index).

export const post = mysqlTable(
  "post",
  {
    id: uuidPrimaryKey("id"),
    title: text("title").notNull(),
    body: json("body").$type<JSONContent>().notNull(),
    authorId: key("author_id").references(() => user.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at"),
    editedAt: timestamp("edited_at"),
    discardedAt: timestamp("discarded_at"),
    createdAt: timestamp("created_at").default(currentTimestamp).notNull(),
    updatedAt: timestamp("updated_at")
      .default(currentTimestamp)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  (table) => [
    index("post_published_at_idx").on(table.publishedAt),
    check("post_discarded_draft_check", sql`${table.discardedAt} is null or ${table.publishedAt} is null`)
  ]
)

export const postRead = mysqlTable(
  "post_read",
  {
    userId: key("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => post.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at").default(currentTimestamp).notNull()
  },
  (table) => [primaryKey({ columns: [table.userId, table.postId] }), index("post_read_post_id_idx").on(table.postId)]
)

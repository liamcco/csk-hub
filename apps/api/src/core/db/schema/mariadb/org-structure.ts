import { GROUP_TYPES } from "@csk-hub/shared/features/org-structure/model"
import { sql } from "drizzle-orm"
import {
  type AnyMySqlColumn,
  boolean,
  check,
  date,
  index,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  uniqueIndex
} from "drizzle-orm/mysql-core"
import { user } from "./auth"
import { key, uuid, uuidPrimaryKey } from "./columns"
import { voice, voiceDivision, voiceDivisionCheck } from "./voice"

// `../postgres/org-structure.ts` on MariaDB; its comments explain the model. MariaDB has no partial
// indexes, so `drizzle-mariadb/20261126074042_baseline/migration.sql` carries these additions written
// by hand, each marked "Hand-written in the MariaDB baseline" here and "Added by hand" there:
//   1. `group_name_choir_active_unique` over invisible generated columns, so only active groups'
//      names are unique, CSK-wide groups (choir_id null) included
//   2. `group_member_current_unique` and `position_holder_current_unique` likewise, over the
//      current (end_date null) rows only
//   3. the `group_member_voice_check` triggers
// drizzle-kit neither generates nor diffs them.

export function groupType(name: string) {
  return mysqlEnum(name, GROUP_TYPES)
}

export const group = mysqlTable(
  "group",
  {
    id: uuidPrimaryKey("id"),
    name: key("name").notNull(),
    type: groupType("type").notNull(),
    choirId: uuid("choir_id").references((): AnyMySqlColumn => choir.groupId, { onDelete: "restrict" }),
    active: boolean("active").default(true).notNull()
  },
  (table) => [
    // Hand-written in the MariaDB baseline (1): group_name_choir_active_unique.
    index("group_choirId_idx").on(table.choirId),
    check("group_name_not_blank_check", sql`length(trim(${table.name})) > 0`),
    check("group_choir_csk_wide_check", sql`${table.type} <> 'Choir' OR ${table.choirId} IS NULL`),
    check("group_section_in_choir_check", sql`${table.type} <> 'Section' OR ${table.choirId} IS NOT NULL`)
  ]
)

export const choir = mysqlTable("choir", {
  groupId: uuid("group_id")
    .primaryKey()
    .references((): AnyMySqlColumn => group.id, { onDelete: "restrict" })
})

export const section = mysqlTable("section", {
  groupId: uuid("group_id")
    .primaryKey()
    .references(() => group.id, { onDelete: "restrict" }),
  voice: voice("voice").notNull()
})

export const groupMember = mysqlTable(
  "group_member",
  {
    userId: key("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "restrict" }),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    // Hand-written in the MariaDB baseline (3): the `group_member_voice_check` triggers.
    voice: voiceDivision("voice")
  },
  (table) => [
    // The key, as a unique index under PostgreSQL's key name: MariaDB names every primary key
    // PRIMARY, and the org structure maps a conflict by this name. InnoDB clusters on it all the same.
    uniqueIndex("group_member_user_id_group_id_start_date_pk").on(table.userId, table.groupId, table.startDate),
    // Hand-written in the MariaDB baseline (2): group_member_current_unique.
    index("group_member_groupId_idx").on(table.groupId),
    check("group_member_period_check", sql`${table.endDate} IS NULL OR ${table.endDate} >= ${table.startDate}`),
    voiceDivisionCheck(table.voice)
  ]
)

export const position = mysqlTable(
  "position",
  {
    id: uuidPrimaryKey("id"),
    name: key("name").notNull()
  },
  (table) => [
    uniqueIndex("position_name_unique").on(table.name),
    check("position_name_not_blank_check", sql`length(trim(${table.name})) > 0`)
  ]
)

export const groupTypePosition = mysqlTable(
  "group_type_position",
  {
    type: groupType("type").notNull(),
    positionId: uuid("position_id")
      .notNull()
      .references(() => position.id, { onDelete: "restrict" })
  },
  (table) => [primaryKey({ columns: [table.type, table.positionId] })]
)

export const positionGroup = mysqlTable(
  "position_group",
  {
    positionId: uuid("position_id")
      .notNull()
      .references(() => position.id, { onDelete: "restrict" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "restrict" })
  },
  (table) => [
    primaryKey({ columns: [table.positionId, table.groupId] }),
    index("position_group_groupId_idx").on(table.groupId)
  ]
)

export const positionHolder = mysqlTable(
  "position_holder",
  {
    userId: key("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => group.id, { onDelete: "restrict" }),
    positionId: uuid("position_id")
      .notNull()
      .references(() => position.id, { onDelete: "restrict" }),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" })
  },
  (table) => [
    // The key under PostgreSQL's name; see `groupMember`.
    uniqueIndex("position_holder_user_id_group_id_position_id_start_date_pk").on(
      table.userId,
      table.groupId,
      table.positionId,
      table.startDate
    ),
    // Hand-written in the MariaDB baseline (2): position_holder_current_unique.
    index("position_holder_userId_idx").on(table.userId),
    check("position_holder_period_check", sql`${table.endDate} IS NULL OR ${table.endDate} >= ${table.startDate}`)
  ]
)

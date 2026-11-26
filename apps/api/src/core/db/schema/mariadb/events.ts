import { EVENT_STATUSES, EVENT_TYPES, PARTICIPATION_MODES } from "@csk-hub/shared/features/events/model"
import type { JSONContent } from "@tiptap/core"
import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  foreignKey,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  unique
} from "drizzle-orm/mysql-core"
import { user } from "./auth"
import { currentTimestamp, key, timestamp, uuid, uuidPrimaryKey } from "./columns"
import { group } from "./org-structure"
import { voiceFamily, voiceFamilyCheck } from "./voice"

// `../postgres/events.ts` on MariaDB; its comments explain the model and which rules the
// database enforces. `drizzle-mariadb/20261126074042_baseline/migration.sql` carries these additions
// written by hand, each marked "Hand-written in the MariaDB baseline" here and "Added by hand" there:
//   1. the triggers PostgreSQL has (mode changes, Responses, Registrations, Registration questions
//      and answers, Erasure), raising the same constraint names
//   2. `location_name_active_unique`, `absence_reason_label_active_unique` and
//      `event_target_unique` over invisible generated columns, since MariaDB has neither partial
//      indexes nor NULLS NOT DISTINCT
//   3. `user_erasure`, a trigger on `user`: InnoDB fires no triggers for changes a foreign key
//      cascades, so Erasure wipes the free text before the User row goes, not after
//   4. `event_delete_registrations`, which removes an Event's Registrations before the Event:
//      InnoDB checks `no action` foreign keys row by row, not at the end of the statement as
//      PostgreSQL does, so deleting an answered question in the same cascade would be refused

function eventType(name: string) {
  return mysqlEnum(name, EVENT_TYPES)
}

export const location = mysqlTable(
  "location",
  {
    id: uuidPrimaryKey("id"),
    name: key("name").notNull(),
    address: text("address"),
    mapUrl: text("map_url"),
    active: boolean("active").default(true).notNull()
  },
  // Hand-written in the MariaDB baseline (2): location_name_active_unique.
  (table) => [check("location_name_not_blank_check", sql`length(trim(${table.name})) > 0`)]
)

export const eventSeries = mysqlTable(
  "event_series",
  {
    id: uuidPrimaryKey("id"),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").default(currentTimestamp).notNull()
  },
  (table) => [check("event_series_name_not_blank_check", sql`length(trim(${table.name})) > 0`)]
)

export const event = mysqlTable(
  "event",
  {
    id: uuidPrimaryKey("id"),
    type: eventType("type").notNull(),
    status: mysqlEnum("status", EVENT_STATUSES).default("Draft").notNull(),
    title: text("title").notNull(),
    description: json("description").$type<JSONContent>(),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at").notNull(),
    allDay: boolean("all_day").default(false).notNull(),
    locationId: uuid("location_id").references(() => location.id, { onDelete: "restrict" }),
    locationText: text("location_text"),
    callTime: timestamp("call_time"),
    respondBy: timestamp("respond_by"),
    // Hand-written in the MariaDB baseline (1): event_participation_mode_change_check.
    participationMode: mysqlEnum("participation_mode", PARTICIPATION_MODES).notNull(),
    organiserGroupId: uuid("organiser_group_id").references(() => group.id, { onDelete: "restrict" }),
    seriesId: uuid("series_id").references(() => eventSeries.id, { onDelete: "restrict" }),
    createdBy: key("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").default(currentTimestamp).notNull()
  },
  (table) => [
    unique("event_id_type_unique").on(table.id, table.type),
    index("event_starts_at_idx").on(table.startsAt),
    index("event_series_id_idx").on(table.seriesId),
    index("event_organiser_group_id_idx").on(table.organiserGroupId),
    check("event_title_not_blank_check", sql`length(trim(${table.title})) > 0`),
    check("event_period_check", sql`${table.endsAt} > ${table.startsAt}`),
    check("event_call_time_check", sql`${table.callTime} IS NULL OR ${table.callTime} <= ${table.startsAt}`),
    check("event_respond_by_check", sql`${table.respondBy} IS NULL OR ${table.respondBy} <= ${table.startsAt}`),
    check("event_respond_by_mode_check", sql`${table.participationMode} <> 'None' OR ${table.respondBy} IS NULL`)
  ]
)

export const eventDetail = mysqlTable(
  "event_detail",
  {
    id: uuidPrimaryKey("id"),
    eventId: uuid("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    value: text("value").notNull(),
    sortOrder: int("sort_order").notNull()
  },
  (table) => [
    index("event_detail_event_id_idx").on(table.eventId),
    check("event_detail_label_not_blank_check", sql`length(trim(${table.label})) > 0`)
  ]
)

export const rehearsal = mysqlTable(
  "rehearsal",
  {
    eventId: uuid("event_id").primaryKey(),
    type: eventType("type").default("Rehearsal").notNull(),
    leaderUserId: key("leader_user_id").references(() => user.id, { onDelete: "set null" })
  },
  (table) => [
    foreignKey({ columns: [table.eventId, table.type], foreignColumns: [event.id, event.type] }).onDelete("cascade"),
    check("rehearsal_type_check", sql`${table.type} = 'Rehearsal'`)
  ]
)

export const gig = mysqlTable(
  "gig",
  {
    eventId: uuid("event_id").primaryKey(),
    type: eventType("type").default("Gig").notNull(),
    responsibleUserId: key("responsible_user_id").references(() => user.id, { onDelete: "set null" }),
    contactName: text("contact_name"),
    contactDetails: text("contact_details")
  },
  (table) => [
    foreignKey({ columns: [table.eventId, table.type], foreignColumns: [event.id, event.type] }).onDelete("cascade"),
    check("gig_type_check", sql`${table.type} = 'Gig'`)
  ]
)

export const socialEvent = mysqlTable(
  "social_event",
  {
    eventId: uuid("event_id").primaryKey(),
    type: eventType("type").default("Social").notNull(),
    costInfo: text("cost_info")
  },
  (table) => [
    foreignKey({ columns: [table.eventId, table.type], foreignColumns: [event.id, event.type] }).onDelete("cascade"),
    check("social_event_type_check", sql`${table.type} = 'Social'`)
  ]
)

export const eventTarget = mysqlTable(
  "event_target",
  {
    id: uuidPrimaryKey("id"),
    eventId: uuid("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => group.id, { onDelete: "restrict" }),
    voiceFamily: voiceFamily("voice_family")
  },
  (table) => [
    // Hand-written in the MariaDB baseline (2): event_target_unique, NULLS NOT DISTINCT.
    index("event_target_event_id_idx").on(table.eventId),
    index("event_target_group_id_idx").on(table.groupId),
    check("event_target_not_empty_check", sql`${table.groupId} IS NOT NULL OR ${table.voiceFamily} IS NOT NULL`),
    voiceFamilyCheck(table.voiceFamily)
  ]
)

export const absenceReason = mysqlTable(
  "absence_reason",
  {
    id: uuidPrimaryKey("id"),
    label: key("label").notNull(),
    active: boolean("active").default(true).notNull()
  },
  // Hand-written in the MariaDB baseline (2): absence_reason_label_active_unique.
  (table) => [check("absence_reason_label_not_blank_check", sql`length(trim(${table.label})) > 0`)]
)

// Hand-written in the MariaDB baseline (1): `event_response_check` and the Erasure trigger.
export const eventResponse = mysqlTable(
  "event_response",
  {
    id: uuidPrimaryKey("id"),
    eventId: uuid("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    userId: key("user_id").references(() => user.id, { onDelete: "set null" }),
    answer: mysqlEnum("answer", ["Yes", "No", "Maybe"]).notNull(),
    comment: text("comment"),
    absenceReasonId: uuid("absence_reason_id").references(() => absenceReason.id, { onDelete: "restrict" }),
    reasonText: text("reason_text"),
    respondedAt: timestamp("responded_at").default(currentTimestamp).notNull()
  },
  (table) => [
    unique("event_response_event_user_unique").on(table.eventId, table.userId),
    index("event_response_user_id_idx").on(table.userId),
    check("event_response_one_reason_check", sql`${table.absenceReasonId} IS NULL OR ${table.reasonText} IS NULL`),
    check(
      "event_response_reason_only_with_no_check",
      sql`${table.answer} = 'No' OR (${table.absenceReasonId} IS NULL AND ${table.reasonText} IS NULL)`
    )
  ]
)

// Hand-written in the MariaDB baseline (1): `event_registration_question_check`.
export const eventRegistrationQuestion = mysqlTable(
  "event_registration_question",
  {
    id: uuidPrimaryKey("id"),
    eventId: uuid("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    kind: mysqlEnum("kind", ["Text", "SingleChoice", "MultipleChoice", "Checkbox"]).notNull(),
    required: boolean("required").default(false).notNull(),
    sortOrder: int("sort_order").notNull()
  },
  (table) => [
    index("event_registration_question_event_id_idx").on(table.eventId),
    check("event_registration_question_label_not_blank_check", sql`length(trim(${table.label})) > 0`)
  ]
)

export const eventRegistrationQuestionOption = mysqlTable(
  "event_registration_question_option",
  {
    id: uuidPrimaryKey("id"),
    questionId: uuid("question_id").notNull(),
    label: text("label").notNull(),
    sortOrder: int("sort_order").notNull()
  },
  (table) => [
    foreignKey({
      name: "event_registration_question_option_question_fk",
      columns: [table.questionId],
      foreignColumns: [eventRegistrationQuestion.id]
    }).onDelete("cascade"),
    unique("event_registration_question_option_question_unique").on(table.questionId, table.id),
    check("event_registration_question_option_label_not_blank_check", sql`length(trim(${table.label})) > 0`)
  ]
)

// Hand-written in the MariaDB baseline (1): `event_registration_check` and the Erasure trigger.
export const eventRegistration = mysqlTable(
  "event_registration",
  {
    id: uuidPrimaryKey("id"),
    eventId: uuid("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    userId: key("user_id").references(() => user.id, { onDelete: "set null" }),
    status: mysqlEnum("status", ["Registered", "Withdrawn"]).default("Registered").notNull(),
    comment: text("comment"),
    registeredAt: timestamp("registered_at").default(currentTimestamp).notNull(),
    withdrawnAt: timestamp("withdrawn_at")
  },
  (table) => [
    unique("event_registration_event_user_unique").on(table.eventId, table.userId),
    index("event_registration_user_id_idx").on(table.userId),
    check(
      "event_registration_withdrawn_check",
      sql`(${table.status} = 'Withdrawn') = (${table.withdrawnAt} IS NOT NULL)`
    )
  ]
)

// Hand-written in the MariaDB baseline (1): `event_registration_answer_check`.
export const eventRegistrationAnswer = mysqlTable(
  "event_registration_answer",
  {
    registrationId: uuid("registration_id").notNull(),
    questionId: uuid("question_id").notNull(),
    text: text("text"),
    checked: boolean("checked")
  },
  (table) => [
    // MariaDB names every primary key PRIMARY, so the key has no name of its own here.
    primaryKey({ columns: [table.registrationId, table.questionId] }),
    foreignKey({
      name: "event_registration_answer_registration_fk",
      columns: [table.registrationId],
      foreignColumns: [eventRegistration.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "event_registration_answer_question_fk",
      columns: [table.questionId],
      foreignColumns: [eventRegistrationQuestion.id]
    }).onDelete("no action"),
    index("event_registration_answer_question_id_idx").on(table.questionId),
    check("event_registration_answer_one_value_check", sql`${table.text} IS NULL OR ${table.checked} IS NULL`)
  ]
)

export const eventRegistrationAnswerChoice = mysqlTable(
  "event_registration_answer_choice",
  {
    registrationId: uuid("registration_id").notNull(),
    questionId: uuid("question_id").notNull(),
    optionId: uuid("option_id").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.registrationId, table.questionId, table.optionId] }),
    foreignKey({
      name: "event_registration_answer_choice_answer_fk",
      columns: [table.registrationId, table.questionId],
      foreignColumns: [eventRegistrationAnswer.registrationId, eventRegistrationAnswer.questionId]
    }).onDelete("cascade"),
    foreignKey({
      name: "event_registration_answer_choice_option_fk",
      columns: [table.questionId, table.optionId],
      foreignColumns: [eventRegistrationQuestionOption.questionId, eventRegistrationQuestionOption.id]
    }).onDelete("no action"),
    index("event_registration_answer_choice_option_idx").on(table.questionId, table.optionId)
  ]
)

export const eventAttendance = mysqlTable(
  "event_attendance",
  {
    id: uuidPrimaryKey("id"),
    eventId: uuid("event_id")
      .notNull()
      .references(() => event.id, { onDelete: "cascade" }),
    userId: key("user_id").references(() => user.id, { onDelete: "set null" }),
    status: mysqlEnum("status", ["Present", "Excused", "Absent"]).notNull(),
    recordedBy: key("recorded_by").references(() => user.id, { onDelete: "set null" }),
    recordedAt: timestamp("recorded_at").default(currentTimestamp).notNull()
  },
  (table) => [
    unique("event_attendance_event_user_unique").on(table.eventId, table.userId),
    index("event_attendance_user_id_idx").on(table.userId)
  ]
)

import { VOICES } from "@csk-hub/shared/features/voice/model"
import { type SQLWrapper, sql } from "drizzle-orm"
import { check, mysqlEnum, mysqlTable, primaryKey } from "drizzle-orm/mysql-core"
import { user } from "./auth"
import { key } from "./columns"

// `../postgres/voice.ts` on MariaDB. PostgreSQL restricts `voice` with the `voice_family` and
// `voice_division` domains. MariaDB has no domains, so a family or division column is a `voice`
// enum with a CHECK constraint of the domain's name, which reports a violation the same way.

type Voice = (typeof VOICES)[number]
type VoiceFamily = Extract<Voice, "S" | "A" | "T" | "B">
type VoiceDivision = Exclude<Voice, VoiceFamily>

const FAMILIES = VOICES.filter((voice) => voice.length === 1)
const DIVISIONS = VOICES.filter((voice) => voice.length === 2)

function oneOf(column: SQLWrapper, voices: readonly string[]) {
  return sql`${column} IN (${sql.join(
    voices.map((voice) => sql.raw(`'${voice}'`)),
    sql`, `
  )})`
}

/** Any Voice: a family or a division. */
export function voice(name: string) {
  return mysqlEnum(name, VOICES)
}

/** A Voice family (S, A, T, B) column; its table adds `voiceFamilyCheck`. */
export function voiceFamily(name: string) {
  return mysqlEnum(name, VOICES).$type<VoiceFamily>()
}

/** A Voice division (S1 … B2) column; its table adds `voiceDivisionCheck`. */
export function voiceDivision(name: string) {
  return mysqlEnum(name, VOICES).$type<VoiceDivision>()
}

/** PostgreSQL's `voice_family` domain, as a CHECK constraint on `column`. */
export function voiceFamilyCheck(column: SQLWrapper) {
  return check("voice_family_check", oneOf(column, FAMILIES))
}

/** PostgreSQL's `voice_division` domain, as a CHECK constraint on `column`. */
export function voiceDivisionCheck(column: SQLWrapper) {
  return check("voice_division_check", oneOf(column, DIVISIONS))
}

export const voiceCapability = mysqlTable(
  "voice_capability",
  {
    userId: key("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    voice: voiceDivision("voice").notNull()
  },
  (table) => [primaryKey({ columns: [table.userId, table.voice] }), voiceDivisionCheck(table.voice)]
)

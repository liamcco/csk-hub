import { sql } from "drizzle-orm"
import { datetime, varchar } from "drizzle-orm/mysql-core"

// The MariaDB spelling of the column types the PostgreSQL schema uses, so each MariaDB table reads
// like its PostgreSQL counterpart in `../postgres`. The values the application sees are the same:
// UUID strings, `Date`s, ISO date strings and parsed JSON.

/** A UUID key. The application generates it, as PostgreSQL's `defaultRandom()` does in the database. */
export function uuid(name: string) {
  return varchar(name, { length: 36 })
}

/** A generated UUID primary key; raw SQL inserts get one from the database's `uuid()`. */
export function uuidPrimaryKey(name: string) {
  return uuid(name)
    .primaryKey()
    .default(sql`(uuid())`)
    .$defaultFn(() => crypto.randomUUID())
}

/**
 * A text identifier, such as a Better Auth ID, or text that is keyed, indexed or unique. MariaDB
 * indexes `varchar`, not `text`; 255 characters holds every value these columns take.
 */
export function key(name: string) {
  return varchar(name, { length: 255 })
}

/**
 * An instant, stored in UTC with millisecond precision. Every connection runs in UTC (see
 * `src/core/db/mariadb/client.ts`), so it is the same instant PostgreSQL's `timestamptz` holds.
 */
export function timestamp(name: string) {
  return datetime(name, { mode: "date", fsp: 3 })
}

/** `now()` at the column's precision, for column defaults. */
export const currentTimestamp = sql`(current_timestamp(3))`

import { type SQL, type SQLWrapper, sql } from "drizzle-orm"
import { isMariaDb } from "./dialect"
import type { Database } from "./index"

/**
 * SQL that reads the same on PostgreSQL and MariaDB. Feature code writes raw SQL through these
 * helpers, or through `portable` when it has no helper, so that no query depends on one database.
 * Each helper renders this process's dialect (see `dialect.ts`).
 */

/** The fragment for this process's dialect. */
export function portable<T>(fragments: { postgresql: T; mariadb: T }): T {
  return isMariaDb ? fragments.mariadb : fragments.postgresql
}

/** The current instant, to the millisecond on MariaDB, as `now()` is on PostgreSQL. */
export function now(): SQL<Date> {
  return portable({ postgresql: sql`now()`, mariadb: sql`now(3)` })
}

/** `instant` plus `milliseconds`, which may be negative. */
export function addMilliseconds(instant: SQLWrapper, milliseconds: number | SQLWrapper): SQL<Date> {
  return portable({
    postgresql: sql`(${instant} + (${milliseconds} * interval '1 millisecond'))`,
    mariadb: sql`(${instant} + interval (${milliseconds} * 1000) microsecond)`
  })
}

/** `instant` plus whole `days`, which may be negative. */
export function addDays(instant: SQLWrapper, days: number): SQL<Date> {
  return portable({
    postgresql: sql`(${instant} + make_interval(days => ${days}))`,
    mariadb: sql`(${instant} + interval ${days} day)`
  })
}

/** Milliseconds from `from` to `to`, as a number. */
export function millisecondsBetween(from: SQLWrapper, to: SQLWrapper): SQL<number> {
  return portable({
    postgresql: sql`(extract(epoch from (${to} - ${from})) * 1000)`,
    mariadb: sql`(timestampdiff(microsecond, ${from}, ${to}) / 1000)`
  })
}

/** A top-level field of a JSON column as text; null when it is missing or null. */
export function jsonText(column: SQLWrapper, field: string): SQL<string | null> {
  return portable({
    postgresql: sql`(${column}->>${field})`,
    mariadb: sql`json_value(${column}, ${`$.${field}`})`
  })
}

/** A top-level field of a JSON column as an integer. */
export function jsonInteger(column: SQLWrapper, field: string): SQL<number | null> {
  return portable({
    postgresql: sql`(${column}->>${field})::integer`,
    mariadb: sql`cast(json_value(${column}, ${`$.${field}`}) as signed)`
  })
}

/**
 * Case-insensitive `LIKE`. `pattern` uses `%` and `_`, escaped with a backslash on both databases.
 * MariaDB's columns compare case-sensitively (the baseline migration's collation), so it lowercases
 * both sides.
 */
export function ilike(column: SQLWrapper, pattern: string): SQL {
  return portable({
    postgresql: sql`${column} ilike ${pattern}`,
    mariadb: sql`lower(${column}) like lower(${pattern})`
  })
}

/** Whether `left` and `right` differ, treating nulls as equal values. */
export function isDistinctFrom(left: SQLWrapper, right: SQLWrapper | unknown): SQL<boolean> {
  return portable({
    postgresql: sql`${left} is distinct from ${right}`,
    mariadb: sql`not (${left} <=> ${right})`
  })
}

/**
 * Whether a JSON column holds a different document than `value`. Key order and whitespace do not
 * count, as with PostgreSQL's jsonb equality.
 */
export function jsonDiffers(column: SQLWrapper, value: unknown): SQL<boolean> {
  const text = JSON.stringify(value)
  return portable({
    postgresql: sql`${column} is distinct from ${text}::jsonb`,
    mariadb: sql`not json_equals(${column}, ${text})`
  })
}

/** A JSON value bound as a parameter, for writing into a JSON document. */
export function jsonValue(value: unknown): SQL {
  const text = JSON.stringify(value)
  return portable({ postgresql: sql`${text}::jsonb`, mariadb: sql`json_extract(${text}, '$')` })
}

/**
 * Serializes transactions on `key` until the current one ends, as PostgreSQL's
 * `pg_advisory_xact_lock` does. Call it inside a transaction.
 *
 * MariaDB's named locks belong to the connection rather than the transaction, so there it locks a
 * row of `advisory_lock`, keyed by the key's SHA-256, which InnoDB holds until commit or rollback.
 */
export async function lockKey(tx: Database, key: string) {
  if (isMariaDb) {
    await tx.execute(
      sql`insert into advisory_lock (lock_key) values (sha2(${key}, 256)) on duplicate key update lock_key = lock_key`
    )
    return
  }
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`)
}

/** The rows a raw query returned. `execute` returns `{ rows }` on PostgreSQL and `[rows, fields]` on MariaDB. */
export async function executeRows<T extends Record<string, unknown>>(database: Database, query: SQL): Promise<T[]> {
  const result = (await database.execute(query)) as unknown
  if (Array.isArray(result)) return (Array.isArray(result[0]) ? result[0] : []) as T[]
  return (result as { rows: T[] }).rows
}

/** How many rows an insert, update or delete without `returning` affected. */
export function affectedRows(result: unknown): number {
  if (Array.isArray(result)) return Number((result[0] as { affectedRows?: number })?.affectedRows ?? 0)
  const shaped = result as { rowCount?: number | null; affectedRows?: number }
  return Number(shaped.rowCount ?? shaped.affectedRows ?? 0)
}

import { type AnyRelations, Column, getTableColumns, is, Param, SQL, StringChunk, sql } from "drizzle-orm"
import { MySqlDialect, type MySqlTable } from "drizzle-orm/mysql-core"
import { MySql2Database } from "drizzle-orm/mysql2"
import { mysql2Codecs } from "drizzle-orm/mysql2/codecs"
import { MySql2Session } from "drizzle-orm/mysql2/session"
import { createPool, type Pool, type PoolOptions } from "mysql2/promise"
import type { Connection } from "../tls"
import { installMariaDbCompat } from "./compat"
import { annotateMariaDbError } from "./errors"

/**
 * The MariaDB client: Drizzle's mysql2 driver with the session settings and SQL the application
 * relies on from PostgreSQL. Every connection runs in UTC, so `now()` and stored timestamps agree
 * with JavaScript dates, and at READ COMMITTED, PostgreSQL's default, which the locking in the
 * feature modules is written for.
 */

type SelectConfig = Parameters<MySqlDialect["buildSelectQuery"]>[0]
type LockingClause = Omit<NonNullable<SelectConfig["lockingClause"]>, "strength"> & { strength: string }

/**
 * PostgreSQL sorts nulls as the largest value, last when ascending and first when descending;
 * MariaDB sorts them as the smallest. A column, `asc(...)` or `desc(...)` is therefore preceded by
 * whether it is null, so lists ordered by a nullable column read the same on both. Other order
 * expressions pass through unchanged.
 */
function withPostgresNullOrder<T>(item: T): T | SQL {
  if (is(item, Column)) return sql`${item} is null, ${item}`
  if (!is(item, SQL)) return item
  // `asc(x)` and `desc(x)` are the chunks [x, " asc"] and [x, " desc"].
  const [expression, last, ...rest] = item.queryChunks
  const direction = !rest.length && is(last, StringChunk) ? String(last.value).trim() : undefined
  if (direction === "asc") return sql`${expression} is null, ${item}`
  if (direction === "desc") return sql`${expression} is null desc, ${item}`
  return item
}

/** MySQL's dialect, with the row-lock clauses, null order and assignment order MariaDB needs. */
class MariaDbDialect extends MySqlDialect {
  /**
   * PostgreSQL evaluates every `SET` expression against the row as it was; MariaDB assigns left to
   * right, and a later expression sees an earlier assignment. Expressions therefore go first and
   * plain values, which read nothing, last, so an expression such as "set `edited_at` when the
   * title changes" compares with the old title, as on PostgreSQL. An expression that reads another
   * expression's column would still see its new value; no update here does that.
   */
  override buildUpdateSet(table: MySqlTable, set: Record<string, unknown>) {
    const columns = getTableColumns(table)
    const assignments = Object.entries(columns)
      .map(([key, column]) => {
        if (set[key] !== undefined) return { column, value: set[key] }
        if (column.onUpdateFn === undefined) return undefined
        const value = column.onUpdateFn()
        return { column, value: is(value, SQL) ? value : sql.param(value, column) }
      })
      .filter((assignment) => assignment !== undefined)
      .sort((first, second) => Number(is(first.value, Param)) - Number(is(second.value, Param)))
    return sql.join(
      assignments.map(({ column, value }) => sql`${sql.identifier(column.name)} = ${value}`),
      sql`, `
    )
  }

  override buildSelectQuery(selectConfig: SelectConfig) {
    const config = { ...selectConfig, orderBy: selectConfig.orderBy?.map(withPostgresNullOrder) }
    const lock = config.lockingClause as LockingClause | undefined
    if (!lock) return super.buildSelectQuery(config)
    // PostgreSQL's weaker exclusive locks are FOR UPDATE here; `of` cannot be expressed, so the
    // lock covers every joined table, which is stricter, never weaker.
    if (lock.strength !== "share" && lock.strength !== "key share")
      return super.buildSelectQuery({ ...config, lockingClause: { ...lock, strength: "update" } as never })
    // MariaDB has no FOR SHARE.
    const query = super.buildSelectQuery({ ...config, lockingClause: undefined })
    return sql`${query} lock in share mode`
  }
}

const SESSION_SETTINGS = "SET time_zone = '+00:00', SESSION transaction_isolation = 'READ-COMMITTED'"

const annotated = new WeakSet<object>()

/** Annotates errors from `query` and `execute` on a pool or one of its connections; see `./errors`. */
function annotateErrors<T extends object>(target: T): T {
  if (annotated.has(target)) return target
  annotated.add(target)
  const methods = target as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
  for (const name of ["query", "execute"]) {
    const original = methods[name]?.bind(target)
    if (!original) continue
    methods[name] = (...args: unknown[]) =>
      original(...args).catch((error: unknown) => {
        throw annotateMariaDbError(error)
      })
  }
  return target
}

/** Pool options for a connection string already paired with its TLS options by `secureConnection`. */
export function mariaDbPoolOptions({ connectionString, ssl }: Connection): PoolOptions {
  const url = new URL(connectionString)
  return {
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    ssl,
    charset: "utf8mb4",
    timezone: "Z",
    connectionLimit: 10,
    enableKeepAlive: true
  }
}

/** Creates the pool: every connection is set up before its first query and annotates its errors. */
export function createMariaDbPool(connection: Connection): Pool {
  const pool = createPool(mariaDbPoolOptions(connection))
  pool.pool.on("connection", (raw) => {
    raw.query(SESSION_SETTINGS)
  })
  annotateErrors(pool)
  const getConnection = pool.getConnection.bind(pool)
  pool.getConnection = async () => annotateErrors(await getConnection())
  return pool
}

/**
 * A Drizzle database on MariaDB. Creating it opens no connection; end it with `$client.end()`.
 * The returned database speaks MySQL's builder API plus the PostgreSQL methods in `./compat`.
 */
export function createMariaDb<R extends AnyRelations>(connection: Connection, relations: R) {
  installMariaDbCompat()
  const client = createMariaDbPool(connection)
  const dialect = new MariaDbDialect({ codecs: mysql2Codecs })
  const session = new MySql2Session(client, dialect, relations, {})
  const database = new MySql2Database(dialect, session, relations) as MySql2Database<R> & { $client: Pool }
  database.$client = client
  return database
}

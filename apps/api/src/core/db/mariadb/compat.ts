import { and, eq, getTableColumns, inArray, type SQL, sql } from "drizzle-orm"
import {
  getTableConfig,
  MySqlDeleteBase,
  MySqlInsertBase,
  type MySqlTable,
  MySqlUpdateBase
} from "drizzle-orm/mysql-core"
import * as drizzleUtils from "drizzle-orm/utils"
import { mariaDbWarningError } from "./errors"

/**
 * The PostgreSQL query-builder methods the application uses, given to Drizzle's MySQL builders so
 * the same feature code runs on MariaDB. Feature code is typed against the PostgreSQL schema; on
 * MariaDB its tables are MySQL tables (see `src/core/db/schema`), so these builders receive the calls.
 *
 * - `insert(...).returning()` and `delete(...).returning()` use MariaDB's native `RETURNING`.
 * - `update(...).returning()` has no MariaDB counterpart. It locks the matching rows by key, updates
 *   exactly those rows and reads them back on one connection, which returns what PostgreSQL would.
 * - `onConflictDoNothing()` is `INSERT IGNORE` followed by `SHOW WARNINGS`: a duplicate key is
 *   skipped as in PostgreSQL, and any other error the server downgraded is raised as that error.
 *   With a `target`, only a duplicate on that key or the primary key is skipped; one on another
 *   key is raised too. MariaDB names only the first key a row collides on, and checks the primary
 *   key first, so a row that repeats both its key and its target cannot be told apart from one that
 *   repeats only its key: unlike PostgreSQL, the latter is skipped rather than raised.
 * - `onConflictDoUpdate({ set })` is `ON DUPLICATE KEY UPDATE`. MariaDB picks the conflicting key
 *   itself, so `target` is ignored; `setWhere`, `where` and `targetWhere` have no translation and throw.
 *
 * Anything else PostgreSQL-only (lateral joins, `distinct on`, PostgreSQL functions in raw SQL) is
 * not emulated: write it portably, or branch with `portable` from `@/core/db/sql`.
 */

type AnyRecord = Record<string, unknown>

// Drizzle's own helpers for building and mapping selections; its published types omit them.
const { mapUpdateSet, orderSelectedFields, resolveNullableObjectPaths } = drizzleUtils as unknown as {
  mapUpdateSet: (table: MySqlTable, set: AnyRecord) => unknown
  orderSelectedFields: (fields: AnyRecord, pathPrefix: undefined, codecs: unknown) => unknown[]
  resolveNullableObjectPaths: (fields: unknown[], nullable: AnyRecord) => unknown
}

type PreparedQuery = { execute: (placeholders?: AnyRecord) => Promise<unknown> }

type Dialect = {
  codecs: unknown
  sqlToQuery: (query: SQL) => unknown
  buildSelection: (fields: unknown[], options: { isSingleTable: boolean; table: MySqlTable }) => SQL
  mapperGenerators: { rows: (fields: unknown[], nullable: unknown) => unknown }
}

type Session = {
  client: unknown
  dialect: Dialect
  prepareQuery: (query: unknown, mode: "arrays" | "raw" | "objects", mapper?: unknown) => PreparedQuery
  transaction: <T>(run: (tx: { session: Session }) => Promise<T>) => Promise<T>
}

type BuilderConfig = AnyRecord & { table: MySqlTable; where?: SQL; ignore?: boolean; onConflict?: SQL }

type Builder = {
  session: Session
  dialect: Dialect
  config: BuilderConfig
  getSQL: () => SQL
  execute: (placeholders?: AnyRecord) => Promise<unknown>
}

/** Thrown for a PostgreSQL builder call that has no faithful MariaDB translation. */
export class UnsupportedOnMariaDbError extends Error {
  override name = "UnsupportedOnMariaDbError"
}

const ER_DUP_ENTRY = 1062
/** Inserts that skip duplicates: on the named keys, or on any key when the set is undefined. */
const ignoringDuplicates = new WeakMap<object, Set<string> | undefined>()

/** Whether the session is bound to one connection, as inside a transaction. */
function inTransaction(session: Session) {
  return !(session.client && typeof session.client === "object" && "getConnection" in session.client)
}

function run(session: Session, query: SQL, mode: "arrays" | "raw" | "objects" = "raw", mapper?: unknown) {
  return session.prepareQuery(session.dialect.sqlToQuery(query), mode, mapper).execute()
}

/**
 * Runs `work` on one connection: inside the caller's transaction as a savepoint, so a raised
 * error leaves that transaction usable as PostgreSQL's would be, or in a transaction of its own.
 * `SHOW WARNINGS` and lock-then-update both need their statements on a single connection.
 */
async function onOneConnection<T>(session: Session, work: (session: Session) => Promise<T>): Promise<T> {
  if (!inTransaction(session)) return session.transaction((tx) => work(tx.session))
  const savepoint = sql.raw(`compat_${crypto.randomUUID().replaceAll("-", "")}`)
  await run(session, sql`savepoint ${savepoint}`)
  try {
    const result = await work(session)
    await run(session, sql`release savepoint ${savepoint}`)
    return result
  } catch (error) {
    await run(session, sql`rollback to savepoint ${savepoint}`).catch(() => undefined)
    throw error
  }
}

/**
 * Raises the first warning an `INSERT IGNORE` downgraded from an error it should have failed with:
 * anything but a duplicate key, or a duplicate on a key outside `skippedKeys` when given.
 */
async function raiseDowngradedErrors(session: Session, skippedKeys: Set<string> | undefined) {
  const warnings = (await run(session, sql`show warnings`, "objects")) as {
    Level: string
    Code: number
    Message: string
  }[]
  const failure = warnings.find((warning) => {
    if (warning.Level === "Note") return false
    if (warning.Code !== ER_DUP_ENTRY) return true
    const key = /for key '([^']+)'/.exec(warning.Message)?.[1]?.split(".").pop()
    return skippedKeys !== undefined && key !== "PRIMARY" && (key === undefined || !skippedKeys.has(key))
  })
  if (failure) throw mariaDbWarningError(failure)
}

/** The names of the unique keys on exactly `target`'s columns, as MariaDB reports them. */
function keysOn(table: MySqlTable, target: unknown): Set<string> {
  const columns = (Array.isArray(target) ? target : [target]) as { name: string }[]
  const wanted = columns
    .map((column) => column.name)
    .sort()
    .join()
  const same = (candidates: { name: string }[]) =>
    candidates
      .map((column) => column.name)
      .sort()
      .join() === wanted
  const config = getTableConfig(table)
  const keys = new Set<string>()
  const primary = config.columns.filter((column) => column.primary)
  if ((primary.length && same(primary)) || config.primaryKeys.some((key) => same(key.columns))) keys.add("PRIMARY")
  for (const index of config.indexes)
    if (index.config.unique && same(index.config.columns as { name: string }[])) keys.add(index.config.name)
  for (const constraint of config.uniqueConstraints) if (same(constraint.columns)) keys.add(constraint.getName() ?? "")
  for (const column of config.columns)
    if (column.isUnique && same([column]) && column.uniqueName) keys.add(column.uniqueName)
  if (!keys.size) throw new UnsupportedOnMariaDbError(`No unique key of ${config.name} is on the conflict target.`)
  return keys
}

/** The selection SQL and row mapper for `fields` (default: every column) of `table`. */
function selectionOf(dialect: Dialect, table: MySqlTable, fields?: AnyRecord) {
  const flat = orderSelectedFields(fields ?? getTableColumns(table), undefined, dialect.codecs)
  return {
    selection: dialect.buildSelection(flat, { isSingleTable: true, table }),
    mapper: dialect.mapperGenerators.rows(flat, resolveNullableObjectPaths(flat, {}))
  }
}

/** Runs `query` followed by `RETURNING fields`, mapped as a select of those fields would be. */
function runReturning(builder: Builder, query: SQL, fields?: AnyRecord) {
  const { selection, mapper } = selectionOf(builder.dialect, builder.config.table, fields)
  return run(builder.session, sql`${query} returning ${selection}`, "arrays", mapper) as Promise<AnyRecord[]>
}

/**
 * The columns that identify a row: the primary key, or else the first unique index whose columns
 * are all required, which InnoDB uses as the clustered key. Used to update exactly the rows read.
 */
function keyColumnsOf(table: MySqlTable) {
  const config = getTableConfig(table)
  const primary = config.columns.filter((column) => column.primary)
  if (primary.length) return primary
  if (config.primaryKeys[0]) return config.primaryKeys[0].columns
  const unique = config.indexes.find(
    (index) => index.config.unique && index.config.columns.every((column) => "notNull" in column && column.notNull)
  )
  if (unique) return unique.config.columns as typeof primary
  throw new UnsupportedOnMariaDbError(`Table ${config.name} has no key to emulate UPDATE ... RETURNING with.`)
}

function matchingKeys(keyColumns: ReturnType<typeof keyColumnsOf>, keys: AnyRecord[]): SQL {
  if (keyColumns.length === 1) {
    const [column] = keyColumns
    return inArray(
      column,
      keys.map((key) => key[column.name])
    ) as SQL
  }
  const rows = keys.map((key) => and(...keyColumns.map((column) => eq(column, key[column.name]))) as SQL)
  return sql`(${sql.join(rows, sql` or `)})`
}

class ReturningQuery<T> implements PromiseLike<T> {
  constructor(private readonly runQuery: () => Promise<T>) {}

  execute() {
    return this.runQuery()
  }

  // biome-ignore lint/suspicious/noThenProperty: a Drizzle query is awaited like a promise.
  then<A = T, B = never>(
    onFulfilled?: (value: T) => A | PromiseLike<A>,
    onRejected?: (reason: unknown) => B | PromiseLike<B>
  ) {
    return this.runQuery().then(onFulfilled, onRejected)
  }

  catch<B = never>(onRejected?: (reason: unknown) => B | PromiseLike<B>) {
    return this.runQuery().catch(onRejected)
  }
}

function insertReturning(this: Builder, fields?: AnyRecord) {
  return new ReturningQuery(async () => {
    if (!ignoringDuplicates.has(this)) return runReturning(this, this.getSQL(), fields)
    return onOneConnection(this.session, async (session) => {
      const rows = await runReturning({ ...this, session } as Builder, this.getSQL(), fields)
      await raiseDowngradedErrors(session, ignoringDuplicates.get(this))
      return rows
    })
  })
}

function insertOnConflictDoNothing(this: Builder, config?: { target?: unknown }) {
  const skippedKeys = config?.target === undefined ? undefined : keysOn(this.config.table, config.target)
  this.config.ignore = true
  ignoringDuplicates.set(this, skippedKeys)
  this.execute = () =>
    onOneConnection(this.session, async (session) => {
      const result = await run(session, this.getSQL())
      await raiseDowngradedErrors(session, skippedKeys)
      return result
    })
  return this
}

function insertOnConflictDoUpdate(this: Builder, config: AnyRecord & { set: AnyRecord }) {
  for (const option of ["setWhere", "where", "targetWhere"])
    if (config[option] !== undefined)
      throw new UnsupportedOnMariaDbError(`onConflictDoUpdate({ ${option} }) has no MariaDB translation.`)
  const set = (this.dialect as unknown as { buildUpdateSet: (table: MySqlTable, set: unknown) => SQL }).buildUpdateSet(
    this.config.table,
    mapUpdateSet(this.config.table, config.set)
  )
  this.config.onConflict = sql`update ${set}`
  return this
}

function deleteReturning(this: Builder, fields?: AnyRecord) {
  return new ReturningQuery(() => runReturning(this, this.getSQL(), fields))
}

function updateReturning(this: Builder, fields?: AnyRecord) {
  return new ReturningQuery(() =>
    onOneConnection(this.session, async (session) => {
      const table = this.config.table
      const keyColumns = keyColumnsOf(table)
      const keyFields = Object.fromEntries(keyColumns.map((column) => [column.name, column]))
      const { selection: keySelection, mapper: keyMapper } = selectionOf(this.dialect, table, keyFields)
      const where = this.config.where ? sql` where ${this.config.where}` : sql``
      const keys = (await run(
        session,
        sql`select ${keySelection} from ${table}${where} for update`,
        "arrays",
        keyMapper
      )) as AnyRecord[]
      if (!keys.length) return []

      const byKey = matchingKeys(keyColumns, keys)
      const dialect = this.dialect as unknown as { buildUpdateQuery: (config: BuilderConfig) => SQL }
      await run(session, dialect.buildUpdateQuery({ ...this.config, where: byKey }))

      const { selection, mapper } = selectionOf(this.dialect, table, fields)
      return run(session, sql`select ${selection} from ${table} where ${byKey}`, "arrays", mapper)
    })
  )
}

let installed = false

/** Adds the PostgreSQL builder methods to Drizzle's MySQL builders, once per process. */
export function installMariaDbCompat() {
  if (installed) return
  installed = true
  Object.assign(MySqlInsertBase.prototype, {
    returning: insertReturning,
    onConflictDoNothing: insertOnConflictDoNothing,
    onConflictDoUpdate: insertOnConflictDoUpdate
  })
  Object.assign(MySqlDeleteBase.prototype, { returning: deleteReturning })
  Object.assign(MySqlUpdateBase.prototype, { returning: updateReturning })
}

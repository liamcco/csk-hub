/**
 * MariaDB reports a violated constraint only inside its error message, while PostgreSQL's driver
 * exposes it as `error.constraint`. Features map violations by that property (see the
 * `violationOf` helpers), so the MariaDB client annotates every driver error with it.
 *
 * The hand-written triggers signal `MYSQL_ERRNO = 4025` with the constraint's name as the whole
 * message, so they map like any CHECK constraint, exactly as the PostgreSQL triggers do.
 */

const ER_DUP_ENTRY = 1062
const ER_ROW_IS_REFERENCED = 1451
const ER_NO_REFERENCED_ROW = 1452
const ER_SIGNAL_EXCEPTION = 1644
const ER_CONSTRAINT_FAILED = 4025

type DriverError = Error & { errno?: number; sqlMessage?: string; constraint?: string }

const IDENTIFIER = /^[A-Za-z0-9_]+$/

/** The constraint a MariaDB error names, or undefined when it names none. */
export function constraintOfMariaDbError(error: { errno?: number; sqlMessage?: string; message?: string }) {
  const message = error.sqlMessage ?? error.message ?? ""
  switch (error.errno) {
    case ER_DUP_ENTRY: {
      // "Duplicate entry 'x' for key 'name'", or 'table.name' in some versions.
      const key = /for key '([^']+)'\s*$/.exec(message)?.[1]
      return key?.split(".").pop()
    }
    case ER_ROW_IS_REFERENCED:
    case ER_NO_REFERENCED_ROW: {
      // drizzle-kit names MySQL foreign keys `…_fkey` and PostgreSQL ones `…_fk`; features map the latter.
      const name = /CONSTRAINT `([^`]+)`/.exec(message)?.[1]
      return name?.replace(/_fkey$/, "_fk")
    }
    case ER_CONSTRAINT_FAILED:
    case ER_SIGNAL_EXCEPTION:
      return /CONSTRAINT `([^`]+)` failed/.exec(message)?.[1] ?? (IDENTIFIER.test(message) ? message : undefined)
    default:
      return undefined
  }
}

/** Sets `constraint` on a MariaDB driver error that names one, and returns the error. */
export function annotateMariaDbError<E>(error: E): E {
  const driverError = error as DriverError
  if (driverError && typeof driverError === "object" && typeof driverError.errno === "number") {
    const constraint = constraintOfMariaDbError(driverError)
    if (constraint && driverError.constraint === undefined) driverError.constraint = constraint
  }
  return error
}

/** A driver-shaped error for a warning MariaDB raised instead of failing, as `INSERT IGNORE` does. */
export function mariaDbWarningError(warning: { Code: number; Message: string }) {
  const error = Object.assign(new Error(warning.Message), { errno: warning.Code, sqlMessage: warning.Message })
  return annotateMariaDbError(error)
}

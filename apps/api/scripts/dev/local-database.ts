import { isLocalDatabase } from "@/core/db/tls"

/** A database this machine runs, which the dev CLI may erase, seed and migrate. */
export type LocalDatabase = {
  url: string
  /** Host, port and database name, with any credentials removed. Safe to print. */
  host: string
}

/** Why the dev CLI refused a database. The message is meant to be read, not debugged. */
export class NotLocalDatabaseError extends Error {
  override name = "NotLocalDatabaseError"
}

/**
 * The database in `url`, provided it is local. Every dev CLI command starts here, so there is no
 * way to point one at a deployed database: production maintenance runs inside the deployed
 * environment through the release image's own commands.
 */
export function requireLocalDatabase(url: string | undefined): LocalDatabase {
  if (!url) {
    throw new NotLocalDatabaseError(
      'POSTGRES_URL is not set. Copy it from .env.example — with the dev Compose stack the value is:\n  POSTGRES_URL="postgresql://csk_hub:csk_hub@localhost:5433/csk_hub"'
    )
  }

  const host = describeHost(url)
  if (!isLocal(url)) {
    throw new NotLocalDatabaseError(
      `The dev CLI is only for local development and refuses ${host}. Point POSTGRES_URL at a database on this machine.`
    )
  }

  return { url, host }
}

function isLocal(url: string): boolean {
  try {
    return isLocalDatabase(url)
  } catch {
    return false
  }
}

function describeHost(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`
  } catch {
    return "<unparseable connection string>"
  }
}

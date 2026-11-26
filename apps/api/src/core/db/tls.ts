import { SUPABASE_ROOT_CA_2021 } from "./certs/supabase-root-2021"
import { dialectOf } from "./dialect"

/**
 * How a connection string is dialled securely. Shared by the application client,
 * `drizzle.config.ts` and the ops CLI so that none of them can verify on weaker terms than
 * the others. It says nothing about *which* database to connect to — callers bring the URL.
 *
 * Relative imports only, never `@/`: drizzle-kit bundles `drizzle.config.ts` without reading
 * tsconfig paths, and this module is on that import path.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

export type Connection = {
  /** The connection string to dial, with any `sslmode` removed. */
  connectionString: string
  /**
   * Verification options, or `undefined` for a local database. A PostgreSQL connection pins the
   * Supabase root CA; a MariaDB connection has no `ca` and is verified against the system trust store.
   */
  ssl?: { ca?: string; rejectUnauthorized: true }
}

/** Whether a connection string points at a database on this machine. */
export function isLocalDatabase(url: string): boolean {
  return LOCAL_HOSTS.has(new URL(url).hostname)
}

/**
 * Pair a connection string with the TLS options to dial it.
 *
 * Anything that is not a local database is verified: PostgreSQL against the Supabase root CA,
 * MariaDB against the system trust store, since managed MariaDB hosts use public CAs. The one
 * exception is a URL that says `sslmode=disable` itself: the self-hosted stack reaches its
 * database over a private Compose network, where there is no certificate to verify. The choice
 * is written in the connection string, so it is visible wherever that string is configured.
 *
 * `sslmode` is stripped deliberately. `pg` treats a `sslmode` in the connection string as
 * authoritative and ignores explicit `ssl` options, so a Supabase URL — they carry
 * `?sslmode=require` — would silently discard the CA and verify against the system trust
 * store instead, which fails. Removing it lets this one policy govern every connection.
 */
export function secureConnection(url: string): Connection {
  const parsed = new URL(url)
  const plainText = parsed.searchParams.get("sslmode") === "disable"
  parsed.searchParams.delete("sslmode")
  const connectionString = parsed.toString()

  if (plainText || isLocalDatabase(url)) return { connectionString }
  if (dialectOf(url) === "mariadb") return { connectionString, ssl: { rejectUnauthorized: true } }

  return { connectionString, ssl: { ca: SUPABASE_ROOT_CA_2021, rejectUnauthorized: true } }
}

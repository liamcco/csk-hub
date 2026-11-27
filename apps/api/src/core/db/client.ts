import { defineRelations } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { databaseDialect, dialectOf } from "./dialect"
import { createMariaDb } from "./mariadb/client"
import * as mariadbAuthSchema from "./schema/mariadb/auth"
import * as authSchema from "./schema/postgres/auth"
import { secureConnection } from "./tls"

function createPostgresDb(url: string) {
  return drizzle({
    connection: secureConnection(url),
    relations: { ...defineRelations(authSchema), ...authSchema.authRelations }
  })
}

/**
 * A database client for an explicit connection string, dialled under the TLS policy in `tls.ts`.
 *
 * The application client, the dev CLI, the test harness and the release image's commands all
 * create clients here, so none of them reads the database URL at import or connects on other terms.
 * Creating a client opens no connection; end it with `client.$client.end()`.
 *
 * The URL must name this process's dialect (see `dialect.ts`): the schemas are chosen when the
 * process starts, so a PostgreSQL process cannot open a MariaDB client, nor the reverse. A MariaDB
 * client is typed as the PostgreSQL one; see `schema/README.md`.
 */
export function createDb(url: string) {
  const dialect = dialectOf(url)
  if (dialect !== databaseDialect) {
    throw new Error(
      `This process runs on ${databaseDialect}, so it cannot open a ${dialect} database. Set DATABASE_URL to choose.`
    )
  }
  if (dialect === "mariadb") {
    const relations = { ...defineRelations(mariadbAuthSchema), ...mariadbAuthSchema.authRelations }
    return createMariaDb(secureConnection(url), relations) as unknown as ReturnType<typeof createPostgresDb>
  }
  return createPostgresDb(url)
}

export type Db = ReturnType<typeof createDb>

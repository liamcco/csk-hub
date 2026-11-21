import { defineRelations } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import * as authSchema from "./schema/auth"
import { secureConnection } from "./tls"

/**
 * A database client for an explicit connection string, dialled under the TLS policy in `tls.ts`.
 *
 * The application client, the dev CLI, the test harness and the release image's commands all
 * create clients here, so none of them reads `POSTGRES_URL` at import or connects on other terms.
 * Creating a client opens no connection; end it with `client.$client.end()`.
 */
export function createDb(url: string) {
  return drizzle({
    connection: secureConnection(url),
    relations: { ...defineRelations(authSchema), ...authSchema.authRelations }
  })
}

export type Db = ReturnType<typeof createDb>

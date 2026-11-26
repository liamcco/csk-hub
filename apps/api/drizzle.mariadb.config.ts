import { defineConfig } from "drizzle-kit"
// Relative imports: drizzle-kit bundles this config without reading tsconfig paths.
import { configuredDatabaseUrl, dialectOf } from "./src/core/db/dialect"
import { mariaDbPoolOptions } from "./src/core/db/mariadb/client"
import { secureConnection } from "./src/core/db/tls"

// The MariaDB counterpart of `drizzle.config.ts`: it generates `drizzle-mariadb/` from
// `src/core/db/schema/mariadb`. `generate` works offline; Studio and `check` connect to the
// MariaDB database in DATABASE_URL.
const url = configuredDatabaseUrl()
const connection = url && dialectOf(url) === "mariadb" ? mariaDbPoolOptions(secureConnection(url)) : undefined

export default defineConfig({
  dialect: "mysql",
  schema: "./src/core/db/schema/mariadb",
  out: "./drizzle-mariadb",
  ...(connection && {
    dbCredentials: {
      host: connection.host as string,
      port: connection.port,
      user: connection.user,
      password: connection.password,
      database: connection.database as string,
      ssl: connection.ssl as never
    }
  })
})

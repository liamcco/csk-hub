/**
 * Writes the API's OpenAPI contract from the route schemas. It assembles the API without a
 * database or listener; run `bun run api:generate` to also regenerate the TypeScript client.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { Database } from "@/core/db"
import type { ApiDependencies } from "@/core/http"

// Feature modules validate configuration when loaded. Assembly never connects or sends anything,
// so placeholders let the export run on a machine without application secrets.
const placeholders = {
  POSTGRES_URL: "postgresql://contract-export@localhost/unused",
  BETTER_AUTH_SECRET: "contract-export",
  // Web Push checks the key shapes when loaded: a 65-byte public and a 32-byte private key.
  VAPID_PUBLIC_KEY: `B${"A".repeat(86)}`,
  VAPID_PRIVATE_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE"
}
for (const [name, value] of Object.entries(placeholders)) process.env[name] ??= value

const { createApi, getApiContract } = await import("@/api/app")

const output = "contract/openapi.json"
await mkdir(dirname(output), { recursive: true })

function unavailable(): never {
  throw new Error("The contract export never handles requests")
}

const contract = getApiContract(
  createApi({
    handleAuth: unavailable,
    resolveRequest: unavailable,
    scheduleDelivery: unavailable,
    authApi: new Proxy({} as ApiDependencies["authApi"], { get: unavailable }),
    database: new Proxy({} as Database, { get: unavailable }),
    secret: "unused"
  })
)
await writeFile(output, `${JSON.stringify(contract, null, 2)}\n`)
console.log(`Wrote ${output}`)

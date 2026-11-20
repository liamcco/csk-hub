/**
 * Writes the API's OpenAPI contract from the route schemas. It assembles the API without a
 * database or listener; run `bun run api:generate` to also regenerate the TypeScript client.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { Database } from "@/core/db"

// Feature modules validate configuration when loaded. Assembly never connects or sends anything,
// so placeholders let the export run on a machine without application secrets.
const placeholders = {
  POSTGRES_URL: "postgresql://contract-export@localhost/unused",
  BETTER_AUTH_SECRET: "contract-export",
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: "contract-export",
  VAPID_PRIVATE_KEY: "contract-export"
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
    database: new Proxy({} as Database, { get: unavailable }),
    secret: "unused"
  })
)
await writeFile(output, `${JSON.stringify(contract, null, 2)}\n`)
console.log(`Wrote ${output}`)

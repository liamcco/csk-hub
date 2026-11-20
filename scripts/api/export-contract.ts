/**
 * Writes the API's OpenAPI contract from the route schemas. It assembles the API without a
 * database or listener; run `bun run api:generate` to also regenerate the TypeScript client.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { createApi, getApiContract } from "@/api/app"

const output = "contract/openapi.json"
await mkdir(dirname(output), { recursive: true })

function unavailable(): never {
  throw new Error("The contract export never handles requests")
}

const contract = getApiContract(createApi({ handleAuth: unavailable, resolveRequest: unavailable }))
await writeFile(output, `${JSON.stringify(contract, null, 2)}\n`)
console.log(`Wrote ${output}`)

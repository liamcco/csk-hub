import { defineConfig } from "@hey-api/openapi-ts"

export default defineConfig({
  input: "../../contract/openapi.json",
  output: "../../contract/client",
  plugins: ["@hey-api/client-fetch", "@hey-api/typescript", "@hey-api/sdk"]
})

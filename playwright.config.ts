import { defineConfig, devices } from "@playwright/test"
import { E2E_API_PORT, E2E_ORIGIN, E2E_PORT } from "./e2e/fixtures"

const stack = Boolean(process.env.E2E_BASE_URL)

/**
 * Browser journeys against the web app and the API. Run them with `bun run e2e`, never directly:
 * by default they start the API and the Vite dev server on a disposable database; with `--stack`
 * they run against the local Docker Compose stack (`deploy/local-stack.sh`).
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    baseURL: E2E_ORIGIN,
    // The local stack serves Caddy's own certificate.
    ignoreHTTPSErrors: stack,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"]
  },
  webServer: stack
    ? undefined
    : [
        {
          command: "bun src/api/server.ts",
          cwd: "apps/api",
          url: `http://localhost:${E2E_API_PORT}/api/auth/ok`,
          timeout: 60_000,
          reuseExistingServer: false,
          stdout: "ignore",
          stderr: "pipe",
          env: {
            PORT: String(E2E_API_PORT),
            BETTER_AUTH_URL: E2E_ORIGIN,
            ENVIRONMENT: "test",
            EMAIL_MODE: "log"
          }
        },
        {
          command: `bunx vite --port ${E2E_PORT} --strictPort`,
          cwd: "apps/web",
          url: `${E2E_ORIGIN}/login`,
          timeout: 120_000,
          reuseExistingServer: false,
          stdout: "ignore",
          stderr: "pipe",
          env: { API_DEV_ORIGIN: `http://localhost:${E2E_API_PORT}` }
        }
      ]
})

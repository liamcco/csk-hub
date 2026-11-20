import { defineConfig, devices } from "@playwright/test"
import { E2E_ORIGIN, E2E_PORT } from "./e2e/fixtures"

/** Browser journeys against the current web app. Run them with `bun run e2e`, never directly. */
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
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"]
  },
  webServer: {
    command: `bunx next dev --port ${E2E_PORT}`,
    url: `${E2E_ORIGIN}/login`,
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      BETTER_AUTH_URL: E2E_ORIGIN,
      ENVIRONMENT: "test",
      EMAIL_MODE: "log"
    }
  }
})

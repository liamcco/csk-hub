/** Where the web app runs during `bun run e2e`: Vite on E2E_PORT, the API beside it on E2E_API_PORT. */
export const E2E_PORT = 3100
export const E2E_API_PORT = 3101
export const E2E_PASSWORD = "journey-test-password"

/** The origin the journeys open: the local Compose stack with `--stack`, otherwise the Vite dev server. */
export const E2E_ORIGIN = process.env.E2E_BASE_URL ?? `http://localhost:${E2E_PORT}`

export type E2EUser = { id: string; email: string; name: string; username: string }

/** Users seeded by `e2e/run.ts` into the journey database. */
export type E2EFixtures = {
  /** An ordinary member. */
  alto: E2EUser
  /** Another ordinary member. */
  tenor: E2EUser
  /** An Admin. */
  admin: E2EUser
  /** A member whose account journeys deactivate. Do not sign in as them elsewhere. */
  leaver: E2EUser
  /** An Admin whose journeys demote them. Do not sign in as them elsewhere. */
  deputy: E2EUser
}

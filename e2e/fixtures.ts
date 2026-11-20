export const E2E_PORT = 3100
export const E2E_ORIGIN = `http://localhost:${E2E_PORT}`
export const E2E_PASSWORD = "journey-test-password"

export type E2EUser = { id: string; email: string; name: string; username: string }

/** Users seeded by `e2e/run.ts` into the disposable database. */
export type E2EFixtures = {
  /** An ordinary member. */
  alto: E2EUser
  /** Another ordinary member. */
  tenor: E2EUser
  /** An Admin. */
  admin: E2EUser
  /** A member whose account journeys deactivate. Do not sign in as them elsewhere. */
  leaver: E2EUser
}

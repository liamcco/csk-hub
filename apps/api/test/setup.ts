import { mock } from "bun:test"

// Keep ordinary unit/DB tests independent of a developer's live-delivery configuration.
// The process-isolated activity integration suite opts in and supplies its own broker prefix.
if (!process.env.CSK_ACTIVITY_TEST) {
  delete process.env.REDIS_URL
}

// Bun fixes a module's export names when it is first loaded. Tests that mock these modules
// with only the exports they use would otherwise hide the rest from every later test file,
// depending on run order. Loading the real modules first keeps every name available.
// The activity suite mocks the database and session modules before loading them itself.
if ((process.env.DATABASE_URL || process.env.POSTGRES_URL) && !process.env.CSK_ACTIVITY_TEST)
  await import("@/core/authz")

mock.module("@csk-hub/shared/core/logging", () => ({
  logger: {
    debug: mock(),
    info: mock(),
    warn: mock(),
    error: mock()
  }
}))

import { mock } from "bun:test"

Object.defineProperty(globalThis, "window", {
  value: {
    location: {
      origin: "http://localhost:3000"
    }
  },
  configurable: true
})

// Bun fixes a module's export names when it is first loaded. Tests that mock these modules
// with only the exports they use would otherwise hide the rest from every later test file,
// depending on run order. Loading the real modules first keeps every name available.
await import("@/core/navigation/router")

mock.module("@csk-hub/shared/core/logging", () => ({
  logger: {
    debug: mock(),
    info: mock(),
    warn: mock(),
    error: mock()
  }
}))

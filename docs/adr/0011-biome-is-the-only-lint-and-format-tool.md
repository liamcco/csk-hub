---
status: proposed
---

# Biome is the only lint and format tool

Biome remains the single linter and formatter for the API, the web app and tooling. `bun run
lint` (`biome check`) runs in CI and `bun run format` applies formatting. We will not add ESLint
or Prettier during the Hono and Vite migration.

Biome already enforces the repository's rules, including `noJsxLiterals` for translated UI, and
covers TypeScript, JSX, JSON and CSS with one configuration and one fast binary. Its React and
Tailwind domains carry over to Vite. A second toolchain would duplicate formatting decisions and
slow CI for little gain.

## Consequences

- Rules that only ESLint plugins offer (for example TanStack Router or Query lint rules) are
  unavailable; we rely on types and tests instead and revisit if a real defect class appears.
- Generated output under `contract/` and `drizzle/` is excluded from Biome. CI checks generated
  files by regenerating them, not by linting them.
- Next.js-specific lint domains are removed when the Next.js runtime is retired.

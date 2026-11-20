/**
 * Runs the Playwright journeys against `next dev` on a disposable PostgreSQL database.
 *
 *   bun --env-file=.env e2e/run.ts [playwright args]
 *
 * Creates and migrates a throwaway database beside the local POSTGRES_URL, seeds the fixture Users,
 * starts Playwright (which starts the web app on that database) and drops the database afterwards.
 */
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createAuth } from "@/core/auth/create-auth"
import { createTestDatabase } from "../test/database"
import { E2E_ORIGIN, E2E_PASSWORD, type E2EFixtures } from "./fixtures"

const database = await createTestDatabase()
if (!database) {
  console.error("The journeys need a reachable local PostgreSQL (POSTGRES_URL). Run `docker compose up -d`.")
  process.exit(1)
}

let exitCode = 1
try {
  const auth = createAuth({
    database: database.db,
    baseURL: E2E_ORIGIN,
    production: false,
    secret: process.env.BETTER_AUTH_SECRET
  })
  async function seed(name: string, username: string, role: "user" | "admin" = "user") {
    const email = `${username}@example.test`
    const created = await auth.api.createUser({
      body: { email, password: E2E_PASSWORD, name, role, data: { username } }
    })
    return { id: created.user.id, email, name, username }
  }

  const fixtures: E2EFixtures = {
    alto: await seed("Alto Anna", "alto"),
    tenor: await seed("Tenor Tor", "tenor"),
    admin: await seed("Admin Ada", "admin", "admin"),
    leaver: await seed("Leaving Lena", "leaver"),
    deputy: await seed("Deputy Dag", "deputy", "admin")
  }
  const directory = mkdtempSync(join(tmpdir(), "csk-e2e-"))
  const fixturesFile = join(directory, "fixtures.json")
  writeFileSync(fixturesFile, JSON.stringify(fixtures))

  // Real-time delivery is optional; the journeys run without Redis.
  const { REDIS_URL: _redis, ...environment } = process.env
  const child = Bun.spawn(["bunx", "playwright", "test", ...process.argv.slice(2)], {
    stdio: ["inherit", "inherit", "inherit"],
    env: {
      ...environment,
      POSTGRES_URL: database.url,
      E2E_DATABASE_URL: database.url,
      E2E_FIXTURES: fixturesFile
    }
  })
  exitCode = await child.exited
} finally {
  await database.drop()
}
process.exit(exitCode)

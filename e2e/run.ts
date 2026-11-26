/**
 * Runs the Playwright journeys.
 *
 *   bun --env-file=.env e2e/run.ts [playwright args]   API + Vite dev server on a disposable database
 *   bun e2e/run.ts --stack [playwright args]           the local Compose stack (deploy/local-stack.sh up)
 *
 * The default mode creates and migrates a throwaway database beside the local DATABASE_URL, seeds
 * the fixture Users, starts Playwright (which starts the API and the web app on that database) and
 * drops the database afterwards. Real-time journeys need the local Redis (REDIS_URL); they get a
 * key prefix of their own.
 *
 * `--stack` seeds the fixture Users into the stack's own database (published on 127.0.0.1 by
 * compose.local.yml) and opens the stack's origin. Run it on a freshly reset stack: the journeys
 * expect only their own Users.
 */
import { randomUUID } from "node:crypto"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseEnv } from "node:util"
import { Client } from "pg"
import { createAuth } from "../apps/api/src/core/auth/create-auth"
import { createDb } from "../apps/api/src/core/db/client"
import { createTestDatabase } from "../apps/api/test/database"
import { E2E_PASSWORD, E2E_PORT, type E2EFixtures } from "./fixtures"

const args = process.argv.slice(2)
const stack = args.includes("--stack")
const playwrightArgs = args.filter((arg) => arg !== "--stack")

type Target = { url: string; origin: string; environment: Record<string, string | undefined>; drop(): Promise<void> }

async function devTarget(): Promise<Target> {
  const database = await createTestDatabase()
  if (!database) {
    console.error("The journeys need a reachable local database (DATABASE_URL). Run `docker compose up -d`.")
    process.exit(1)
  }
  const origin = `http://localhost:${E2E_PORT}`
  return {
    url: database.url,
    origin,
    environment: {
      DATABASE_URL: database.url,
      ...(process.env.REDIS_URL ? { REDIS_KEY_PREFIX: `csk-e2e-${randomUUID().slice(0, 8)}` } : {})
    },
    drop: () => database.drop()
  }
}

function stackTarget(): Target {
  const file = process.env.STACK_ENV ?? join(import.meta.dir, "../deploy/local.env")
  const stackEnv = parseEnv(readFileSync(file, "utf8"))
  const port = stackEnv.DB_PORT ?? "5434"
  const origin = stackEnv.BETTER_AUTH_URL
  if (!origin || !stackEnv.POSTGRES_PASSWORD) throw new Error(`${file} lacks BETTER_AUTH_URL or POSTGRES_PASSWORD.`)
  return {
    url: `postgresql://csk_hub:${stackEnv.POSTGRES_PASSWORD}@127.0.0.1:${port}/csk_hub?sslmode=disable`,
    origin,
    environment: { E2E_BASE_URL: origin, E2E_STACK: "1" },
    drop: async () => {}
  }
}

const target = stack ? stackTarget() : await devTarget()
let exitCode = 1
try {
  const database = createDb(target.url)
  const auth = createAuth({ database, baseURL: target.origin, production: false, secret: "journey-seed-only" })
  async function seed(name: string, username: string, role: "user" | "admin" = "user") {
    const email = `${username}@example.test`
    const created = await auth.api.createUser({
      body: { email, password: E2E_PASSWORD, name, role, data: { username } }
    })
    // Activated members have verified their email; the stack's production auth requires it.
    const client = new Client({ connectionString: target.url })
    await client.connect()
    await client.query(`update "user" set email_verified = true where id = $1`, [created.user.id])
    await client.end()
    return { id: created.user.id, email, name, username }
  }

  const fixtures: E2EFixtures = {
    alto: await seed("Alto Anna", "alto"),
    tenor: await seed("Tenor Tor", "tenor"),
    admin: await seed("Admin Ada", "admin", "admin"),
    leaver: await seed("Leaving Lena", "leaver"),
    deputy: await seed("Deputy Dag", "deputy", "admin")
  }
  await database.$client.end()
  const directory = mkdtempSync(join(tmpdir(), "csk-e2e-"))
  const fixturesFile = join(directory, "fixtures.json")
  writeFileSync(fixturesFile, JSON.stringify(fixtures))

  const child = Bun.spawn(["bunx", "playwright", "test", ...playwrightArgs], {
    stdio: ["inherit", "inherit", "inherit"],
    env: {
      ...process.env,
      ...target.environment,
      E2E_DATABASE_URL: target.url,
      E2E_FIXTURES: fixturesFile
    }
  })
  exitCode = await child.exited
} finally {
  await target.drop()
}
process.exit(exitCode)

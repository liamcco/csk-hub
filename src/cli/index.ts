#!/usr/bin/env bun
import { createInterface } from "node:readline/promises"
import { parseArgs } from "node:util"
import type { AdminOutcome } from "./admin"

/**
 * Maintenance commands shipped in the release image. They run inside the deployed environment,
 * against its own database and email configuration; nothing here chooses a target.
 *
 * In the image this file is bundled to `/app/cli.js`, so from the app container's console:
 *
 *   bun cli.js migrate
 *   bun cli.js org bootstrap
 *   bun cli.js admin bootstrap --email person@example.org --name "Person" [--yes]
 *   bun cli.js admin recover --email person@example.org
 */

const USAGE = `Usage:
  bun cli.js migrate                                         apply pending migrations and exit
  bun cli.js org bootstrap                                   create the default org structure in a new environment
  bun cli.js admin bootstrap --email <email> --name <name>   invite an Admin, or resend their activation or recovery email
  bun cli.js admin recover --email <email>                   send a password-reset email to an existing Admin`

class UsageError extends Error {}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      email: { type: "string" },
      name: { type: "string" },
      yes: { type: "boolean", short: "y", default: false }
    },
    allowPositionals: true,
    strict: true
  })
  const command = positionals.join(" ")

  switch (command) {
    case "migrate":
      return migrate()
    case "org bootstrap":
      return orgBootstrap()
    case "admin bootstrap": {
      const email = required(values.email, "--email")
      const name = required(values.name, "--name")
      const { bootstrapAdmin } = await import("./admin")
      return withRuntime(async (runtime) =>
        report(await bootstrapAdmin({ ...runtime, email, name, confirm: (question) => confirm(question, values.yes) }))
      )
    }
    case "admin recover": {
      const email = required(values.email, "--email")
      const { recoverAdmin } = await import("./admin")
      return withRuntime(async (runtime) => report(await recoverAdmin({ ...runtime, email })))
    }
    default:
      throw new UsageError(command ? `Unknown command "${command}".` : "No command given.")
  }
}

/**
 * Apply pending migrations and exit: the Compose `migrate` service. It needs only POSTGRES_URL, so
 * it never loads the rest of the application's configuration.
 */
async function migrate(): Promise<number> {
  const url = process.env.POSTGRES_URL
  if (!url) throw new UsageError("POSTGRES_URL is not set.")
  const { createDb } = await import("@/core/db/client")
  const { migrateDatabase } = await import("@/core/db/migrate")

  const database = createDb(url)
  try {
    await migrateDatabase(database, { migrationsFolder: process.env.MIGRATIONS_FOLDER ?? "drizzle" })
    console.log("Migrations applied; the database is up to date.")
    return 0
  } catch (error) {
    console.error("✖ Migration failed; the app must not start on this database.")
    console.error(error instanceof Error ? (error.cause ?? error) : error)
    return 1
  } finally {
    await database.$client.end().catch(() => {})
  }
}

async function orgBootstrap(): Promise<number> {
  const { bootstrapOrgStructure } = await import("@/features/org-structure/defaults")
  return withRuntime(async ({ database }) => {
    const { created } = await bootstrapOrgStructure(database)
    console.log(
      created
        ? "Created the default Choirs, Sections, groups and Positions."
        : "This environment already has groups or Positions; nothing was created."
    )
    return 0
  })
}

type Runtime = {
  auth: import("@/core/auth/create-auth").Auth
  database: import("@/core/db/client").Db
}

/** The deployed environment's database and Better Auth, from its own configuration. */
async function withRuntime(work: (runtime: Runtime) => Promise<number>): Promise<number> {
  const { env, isProduction } = await import("@/core/config/env")
  const { createDb } = await import("@/core/db/client")
  const { createAuth } = await import("@/core/auth/create-auth")
  const { getBaseURL } = await import("@/core/auth/base-url")

  const database = createDb(env.POSTGRES_URL)
  try {
    const auth = createAuth({ database, baseURL: getBaseURL(env), production: isProduction })
    return await work({ auth, database })
  } finally {
    await database.$client.end().catch(() => {})
  }
}

function report(outcome: AdminOutcome): number {
  switch (outcome.kind) {
    case "invited":
      console.log("Created the Admin and sent an activation invitation.")
      return 0
    case "activation-resent":
      console.log("Sent the activation email again.")
      return 0
    case "recovery-sent":
      console.log("Sent a password-reset email.")
      return 0
    case "unchanged":
      console.log("Nothing was changed or sent.")
      return 0
    case "refused":
      console.error(
        {
          "not-found": "✖ No account has that email.",
          "not-admin":
            "✖ That account is not an Admin. Promoting an existing member is a separate operation; members who forgot their password use the app's reset flow.",
          deactivated: "✖ That Admin is deactivated. Reactivating an account is a separate operation."
        }[outcome.reason]
      )
      return 1
  }
}

/** Ask a yes/no question on the console. Without a terminal, only `--yes` answers it. */
async function confirm(question: string, yes: boolean): Promise<boolean> {
  if (yes) return true
  if (!process.stdin.isTTY) {
    console.error(`${question}\nNo terminal to answer this; pass --yes to proceed.`)
    return false
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return /^y(es)?$/i.test((await prompt.question(`${question} [y/N] `)).trim())
  } finally {
    prompt.close()
  }
}

function required(value: string | undefined, flag: string): string {
  if (!value?.trim()) throw new UsageError(`${flag} is required.`)
  return value.trim()
}

process.exit(
  await main(process.argv.slice(2)).catch((error: unknown) => {
    if (error instanceof UsageError || (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      console.error(`✖ ${(error as Error).message}\n\n${USAGE}`)
      return 1
    }
    throw error
  })
)

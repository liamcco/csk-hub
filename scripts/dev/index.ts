#!/usr/bin/env bun
import { spawnSync } from "node:child_process"
import { parseArgs } from "node:util"
import { intro, isCancel, log, outro, select } from "@clack/prompts"
import { createDb } from "@/core/db/client"
import { migrateDatabase } from "@/core/db/migrate"
import { bootstrapOrgStructure } from "@/features/org-structure/defaults"
import { type LocalDatabase, NotLocalDatabaseError, requireLocalDatabase } from "./local-database"
import { MIGRATIONS_FOLDER, statusOf } from "./migration-status"
import { resetLocalDatabase } from "./reset"
import { SEED_PASSWORD } from "./seeds/data"
import { seedDemo } from "./seeds/demo"
import { seedEvents } from "./seeds/events"
import { seedGroups } from "./seeds/groups"
import { seedPosts } from "./seeds/posts"
import { seedUsers } from "./seeds/users"

/**
 * The local development database CLI. It only ever reaches the local database in POSTGRES_URL;
 * production maintenance runs inside the deployed environment (see `deploy/README.md`).
 *
 *   bun run db [command] [--yes]
 *
 * With no command it shows the migration status and, in a terminal, opens a menu.
 */

const DIM = "\x1b[2m"
const RED = "\x1b[31m"
const GREEN = "\x1b[32m"
const YELLOW = "\x1b[33m"
const RESET = "\x1b[0m"

const COMMANDS = {
  status: "Migration status",
  migrate: "Run migrations",
  studio: "Open Drizzle Studio",
  reset: "Reset: erase, migrate and create the default org structure",
  "org-bootstrap": "Create the default org structure (empty databases only)",
  "seed-users": "Seed 100 example users, three of them Admins",
  "seed-groups": "Seed example groups, placements and history",
  "seed-posts": "Seed 24 example Posts",
  "seed-events": "Seed example Events",
  "seed-demo": "Seed the complete demo (org structure, users, groups, Posts, Events)"
} as const
type Command = keyof typeof COMMANDS

function isCommand(value: string): value is Command {
  return value in COMMANDS
}

/** Runs one command against the local database and returns its exit code. */
async function run(command: Command, database: LocalDatabase, { yes }: { yes: boolean }): Promise<number> {
  if (command === "status") {
    await showStatus(database)
    return 0
  }
  if (command === "reset") return resetLocalDatabase(database, { skipConfirmation: yes })
  if (command === "studio") {
    log.info("Starting Drizzle Studio — press Ctrl+C to return.")
    const studio = spawnSync("bunx", ["drizzle-kit", "studio"], {
      stdio: "inherit",
      env: { ...process.env, POSTGRES_URL: database.url }
    })
    return studio.status ?? 1
  }

  const client = createDb(database.url)
  try {
    switch (command) {
      case "migrate":
        await migrateDatabase(client, { migrationsFolder: MIGRATIONS_FOLDER })
        await showStatus(database)
        break
      case "org-bootstrap": {
        const { created } = await bootstrapOrgStructure(client)
        console.log(
          created
            ? "Created the default Choirs, Sections, groups and Positions."
            : "The org structure already has groups or Positions; nothing was created."
        )
        break
      }
      case "seed-users": {
        const { created } = await seedUsers(client)
        console.log(`Created ${created} of 100 example users. ${loginHint()}`)
        break
      }
      case "seed-groups": {
        const { created, placed } = await seedGroups(client)
        console.log(created.length > 0 ? `Created groups: ${created.join(", ")}` : "Example groups already exist.")
        console.log(`Placed ${placed} user(s) in a Section; added missing demo group and Position history.`)
        break
      }
      case "seed-posts":
        console.log(`Created ${(await seedPosts(client)).created} of 24 example Posts.`)
        break
      case "seed-events": {
        const { created } = await seedEvents(client)
        console.log(created.length > 0 ? `Created Events: ${created.join(", ")}` : "Example Events already exist.")
        break
      }
      case "seed-demo": {
        const result = await seedDemo(client)
        console.log(
          `${result.org.created ? "Created the default org structure; " : ""}Created ${result.users.created} users, ${result.groups.created.length} groups, ${result.posts.created} Posts and ${result.events.created.length} Events; placed ${result.groups.placed} singers.`
        )
        console.log(loginHint())
        break
      }
    }
    return 0
  } finally {
    await client.$client.end()
  }
}

function loginHint() {
  return `Login: singer-001@example.com … singer-100@example.com. Password: ${SEED_PASSWORD}. First three: Admins.`
}

async function showStatus(database: LocalDatabase): Promise<void> {
  const status = await statusOf(database)

  if (status.kind === "unreachable") {
    log.message(`${RED}unreachable${RESET} ${DIM}${status.host}${RESET}\n${DIM}${status.reason}${RESET}`)
    return
  }

  const total = status.applied.length + status.pending.length
  if (status.pending.length === 0) {
    log.message(`${GREEN}up to date${RESET} ${DIM}${status.host} — ${total} migration(s)${RESET}`)
    return
  }

  const pending = status.pending.map((tag) => `\n${DIM}pending: ${tag}${RESET}`).join("")
  log.message(
    `${YELLOW}${status.pending.length} behind${RESET} ${DIM}${status.host} — ${status.applied.length}/${total} applied${RESET}${pending}`
  )
}

async function menu(database: LocalDatabase): Promise<void> {
  while (true) {
    const choice = await select<Command | "exit">({
      message: "What would you like to do?",
      options: [
        ...Object.entries(COMMANDS).map(([value, label]) => ({ value: value as Command, label })),
        { value: "exit", label: "Exit" }
      ]
    })
    if (isCancel(choice) || choice === "exit") return
    await run(choice, database, { yes: false }).catch(report)
  }
}

function report(error: unknown): number {
  console.error(`✖ ${error instanceof Error ? error.message : String(error)}`)
  return 1
}

async function main(): Promise<number> {
  const { values: flags, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: { yes: { type: "boolean", short: "y", default: false } },
    allowPositionals: true,
    strict: true
  })
  const [command] = positionals
  if (command !== undefined && !isCommand(command)) {
    console.error(`✖ Unknown command "${command}". Expected one of: ${Object.keys(COMMANDS).join(", ")}.`)
    return 1
  }

  const database = requireLocalDatabase(process.env.POSTGRES_URL)
  intro(`csk-hub dev database  ${DIM}(${database.host})${RESET}`)

  if (command !== undefined) {
    const code = await run(command, database, flags)
    outro("")
    return code
  }

  await showStatus(database)
  // Without a terminal there is nobody to answer the menu, so stop after the status.
  if (process.stdin.isTTY) await menu(database)
  outro("Done.")
  return 0
}

process.exit(
  await main().catch((error: unknown) => {
    if (error instanceof NotLocalDatabaseError || (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      return report(error)
    }
    throw error
  })
)

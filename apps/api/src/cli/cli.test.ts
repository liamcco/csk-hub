import { afterAll, describe, expect, test } from "bun:test"
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { sql } from "drizzle-orm"
import { createConnection } from "mysql2/promise"
import { Client } from "pg"
import { isMariaDb } from "@/core/db/dialect"
import { mariaDbPoolOptions } from "@/core/db/mariadb/client"
import { migrationsFolderName } from "@/core/db/migrate"
import { executeRows } from "@/core/db/sql"
import { secureConnection } from "@/core/db/tls"
import { createTestDatabase } from "../../test/database"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

async function runCli(
  args: string[],
  environment: Record<string, string | undefined>,
  entry = ["--conditions=react-server", "src/cli/index.ts"]
) {
  const child = Bun.spawn([process.execPath, ...entry, ...args], {
    cwd: ROOT,
    env: Object.fromEntries(
      Object.entries({ ...process.env, ...environment }).filter(
        (entry): entry is [string, string] => entry[1] !== undefined
      )
    ),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe"
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ])
  return { code, stdout, stderr }
}

describe("release image CLI", () => {
  test("names its commands and exits non-zero on an unknown one", async () => {
    const { code, stderr } = await runCli(["grant-admin"], {})
    expect(code).toBe(1)
    expect(stderr).toContain("migrate")
    expect(stderr).toContain("admin bootstrap --email")
  })

  test("admin bootstrap needs an email and a name", async () => {
    const { code, stderr } = await runCli(["admin", "bootstrap", "--email", "person@example.org"], {})
    expect(code).toBe(1)
    expect(stderr).toContain("--name")
  })
})

/** The migration ledger, which each dialect keeps in its own place. */
const LEDGER = isMariaDb ? "`__drizzle_migrations`" : "drizzle.__drizzle_migrations"
/** A runtime role's refusal of a statement it has no privilege for. */
const DENIED = isMariaDb ? { errno: 1142 } : { code: "42501" }
/** A quoted identifier in hand-written SQL. */
const q = (name: string) => (isMariaDb ? `\`${name}\`` : `"${name}"`)

/** Runs one statement as the role in `url`, resolving its rows. */
async function asRole(url: string, statement: string): Promise<unknown[]> {
  if (isMariaDb) {
    const connection = await createConnection(mariaDbPoolOptions(secureConnection(url)))
    try {
      const [rows] = await connection.query(statement)
      return rows as unknown[]
    } finally {
      await connection.end()
    }
  }
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    return (await client.query(statement)).rows
  } finally {
    await client.end()
  }
}

const empty = await createTestDatabase(null)

describe.skipIf(!empty)("release image migrate on an empty database", () => {
  const t = empty as NonNullable<typeof empty>
  afterAll(() => t.drop())

  test("applies pending migrations and exits 0, needing only DATABASE_URL", async () => {
    const { code, stdout } = await runCli(["migrate"], {
      DATABASE_URL: t.url,
      BETTER_AUTH_SECRET: undefined,
      VAPID_PRIVATE_KEY: undefined
    })

    expect(code).toBe(0)
    expect(stdout).toContain("Migrations applied")
    const [ledger] = await executeRows<{ count: number }>(t.db, sql.raw(`select count(*) as count from ${LEDGER}`))
    expect(Number(ledger?.count)).toBeGreaterThan(0)
  }, 60_000)
})

const database = await createTestDatabase()

describe.skipIf(!database)("release image migrate", () => {
  const t = database as NonNullable<typeof database>
  const folders: string[] = []
  const roles: string[] = []
  afterAll(async () => {
    for (const folder of folders) rmSync(folder, { recursive: true, force: true })
    await t.drop()
    // Roles belong to the whole server, not the dropped database.
    const owner = process.env.DATABASE_URL || process.env.POSTGRES_URL || ""
    for (const role of roles)
      await asRole(owner, isMariaDb ? `DROP USER IF EXISTS '${role}'@'%'` : `DROP ROLE IF EXISTS "${role}"`)
  })

  test("gives the runtime role data access only, and rotates its password on every run", async () => {
    const role = `csk_hub_runtime_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`
    roles.push(role)
    function runtimeUrl(password: string) {
      const url = new URL(t.url)
      url.username = role
      url.password = password
      return url.toString()
    }
    const asRuntime = (statement: string) => asRole(runtimeUrl("second-password"), statement)

    for (const password of ["first-password", "second-password"]) {
      const { code, stdout } = await runCli(["migrate"], {
        DATABASE_URL: t.url,
        DATABASE_RUNTIME_URL: runtimeUrl(password)
      })
      expect(code).toBe(0)
      expect(stdout).toContain(role)
    }

    const id = "'00000000-0000-4000-8000-000000000001'"
    await asRuntime(`INSERT INTO ${q("location")} (${q("id")}, ${q("name")}) VALUES (${id}, 'Runtime role check')`)
    expect(await asRuntime(`SELECT ${q("name")} FROM ${q("location")} WHERE ${q("id")} = ${id} FOR UPDATE`)).toEqual([
      { name: "Runtime role check" }
    ])
    await asRuntime(`DELETE FROM ${q("location")} WHERE ${q("id")} = ${id}`)
    for (const statement of [
      "CREATE TABLE runtime_probe (id int)",
      `DROP TABLE ${q("location")}`,
      `ALTER TABLE ${q("location")} ADD COLUMN x int`
    ]) {
      await expect(asRuntime(statement)).rejects.toMatchObject(DENIED)
    }
    await expect(asRuntime(`SELECT count(*) FROM ${LEDGER}`)).rejects.toMatchObject(DENIED)
  }, 60_000)

  test("exits non-zero when a migration fails, so Compose never starts the app", async () => {
    const folder = mkdtempSync(join(tmpdir(), "csk-migrations-"))
    folders.push(folder)
    cpSync(join(ROOT, migrationsFolderName), folder, { recursive: true })
    const broken = join(folder, "29991231235959_broken")
    const [latest] = readdirSync(join(ROOT, migrationsFolderName))
      .filter((name) => /^\d{14}_/.test(name))
      .sort()
      .reverse()
    cpSync(join(ROOT, migrationsFolderName, latest as string), broken, { recursive: true })
    writeFileSync(join(broken, "migration.sql"), "SELECT * FROM a_table_that_does_not_exist;")

    const { code, stderr } = await runCli(["migrate"], { DATABASE_URL: t.url, MIGRATIONS_FOLDER: folder })

    expect(code).toBe(1)
    expect(stderr).toContain("Migration failed")
  }, 60_000)

  test("the bundle shipped in the image loads Better Auth and runs the admin commands", async () => {
    const outdir = mkdtempSync(join(tmpdir(), "csk-cli-"))
    folders.push(outdir)
    // The same build as deploy/Dockerfile.
    const build = Bun.spawnSync(
      [
        process.execPath,
        "build",
        "src/cli/index.ts",
        "--target=bun",
        "--conditions=react-server",
        "--external=pg-native",
        `--outfile=${join(outdir, "cli.js")}`
      ],
      { cwd: ROOT, stdout: "pipe", stderr: "pipe" }
    )
    expect(build.exitCode).toBe(0)

    const { code, stderr } = await runCli(
      ["admin", "recover", "--email", "nobody@example.test"],
      { DATABASE_URL: t.url },
      [join(outdir, "cli.js")]
    )

    expect(stderr).toContain("No account has that email")
    expect(code).toBe(1)
  }, 60_000)
})

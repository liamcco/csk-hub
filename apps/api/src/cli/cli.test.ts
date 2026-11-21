import { afterAll, describe, expect, test } from "bun:test"
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { sql } from "drizzle-orm"
import { Client } from "pg"
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

const database = await createTestDatabase()

describe.skipIf(!database)("release image migrate", () => {
  const t = database as NonNullable<typeof database>
  const folders: string[] = []
  const roles: string[] = []
  afterAll(async () => {
    for (const folder of folders) rmSync(folder, { recursive: true, force: true })
    await t.drop()
    // Roles belong to the whole server, not the dropped database.
    const admin = new Client({ connectionString: process.env.POSTGRES_URL })
    await admin.connect()
    for (const role of roles) await admin.query(`DROP ROLE IF EXISTS "${role}"`)
    await admin.end()
  })

  test("applies pending migrations and exits 0, needing only POSTGRES_URL", async () => {
    await t.db.execute(sql`DROP SCHEMA "drizzle" CASCADE`)
    await t.db.execute(sql`DROP SCHEMA "public" CASCADE`)
    await t.db.execute(sql`CREATE SCHEMA "public"`)

    const { code, stdout } = await runCli(["migrate"], {
      POSTGRES_URL: t.url,
      BETTER_AUTH_SECRET: undefined,
      VAPID_PRIVATE_KEY: undefined
    })

    expect(code).toBe(0)
    expect(stdout).toContain("Migrations applied")
    const { rows } = await t.db.execute<{ count: number }>(
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`
    )
    expect(rows[0]?.count).toBeGreaterThan(0)
  }, 60_000)

  test("gives the runtime role data access only, and rotates its password on every run", async () => {
    const role = `csk_hub_runtime_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`
    roles.push(role)
    function runtimeUrl(password: string) {
      const url = new URL(t.url)
      url.username = role
      url.password = password
      return url.toString()
    }
    async function asRuntime(statement: string) {
      const client = new Client({ connectionString: runtimeUrl("second-password") })
      await client.connect()
      try {
        return await client.query(statement)
      } finally {
        await client.end()
      }
    }

    for (const password of ["first-password", "second-password"]) {
      const { code, stdout } = await runCli(["migrate"], {
        POSTGRES_URL: t.url,
        POSTGRES_RUNTIME_URL: runtimeUrl(password)
      })
      expect(code).toBe(0)
      expect(stdout).toContain(role)
    }

    await asRuntime(
      `INSERT INTO "location" ("id", "name") VALUES ('00000000-0000-4000-8000-000000000001', 'Runtime role check')`
    )
    expect(
      (await asRuntime(`SELECT "name" FROM "location" WHERE "id" = '00000000-0000-4000-8000-000000000001' FOR UPDATE`))
        .rows
    ).toEqual([{ name: "Runtime role check" }])
    await asRuntime(`DELETE FROM "location" WHERE "id" = '00000000-0000-4000-8000-000000000001'`)
    for (const statement of [
      "CREATE TABLE runtime_probe (id int)",
      'DROP TABLE "location"',
      'ALTER TABLE "location" ADD COLUMN x int'
    ]) {
      await expect(asRuntime(statement)).rejects.toMatchObject({ code: "42501" })
    }
    await expect(asRuntime("SELECT count(*) FROM drizzle.__drizzle_migrations")).rejects.toMatchObject({
      code: "42501"
    })
  }, 60_000)

  test("exits non-zero when a migration fails, so Compose never starts the app", async () => {
    const folder = mkdtempSync(join(tmpdir(), "csk-migrations-"))
    folders.push(folder)
    cpSync(join(ROOT, "drizzle"), folder, { recursive: true })
    const broken = join(folder, "29991231235959_broken")
    cpSync(join(ROOT, "drizzle", "20261102205910_add-realtime-delivery"), broken, { recursive: true })
    writeFileSync(join(broken, "migration.sql"), "SELECT * FROM a_table_that_does_not_exist;")

    const { code, stderr } = await runCli(["migrate"], { POSTGRES_URL: t.url, MIGRATIONS_FOLDER: folder })

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
      { POSTGRES_URL: t.url },
      [join(outdir, "cli.js")]
    )

    expect(stderr).toContain("No account has that email")
    expect(code).toBe(1)
  }, 60_000)
})

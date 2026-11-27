import { describe, expect, test } from "bun:test"
import { runDevCli } from "./test-support"

const REMOTE = "postgresql://someone:secret@db.example.com:5432/csk_hub?sslmode=require"

describe("dev CLI", () => {
  test.each(["status", "migrate", "studio", "reset --yes", "org-bootstrap", "seed-users", "seed-demo"])(
    "refuses a database that is not local: %s",
    async (command) => {
      const { code, stderr } = await runDevCli(command.split(" "), { DATABASE_URL: REMOTE })
      expect(code).toBe(1)
      expect(stderr).toContain("only for local development")
      expect(stderr).toContain("db.example.com")
      // The refusal names the host, never the credentials.
      expect(stderr).not.toContain("secret")
    }
  )

  test("refuses when no database is configured", async () => {
    const { code, stderr } = await runDevCli(["migrate"], { DATABASE_URL: "", POSTGRES_URL: "" })
    expect(code).toBe(1)
    expect(stderr).toContain("DATABASE_URL is not set")
  })

  test("has no production target", async () => {
    const { code, stderr } = await runDevCli(["migrate", "--prod"], {})
    expect(code).toBe(1)
    expect(stderr).toContain("--prod")
  })
})

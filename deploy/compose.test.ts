import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

type Service = {
  image?: string
  command?: string[]
  restart?: string
  depends_on?: Record<string, { condition: string }>
  environment?: Record<string, string>
  ports?: string[]
}

const stack = Bun.YAML.parse(readFileSync(new URL("compose.yml", import.meta.url), "utf8")) as {
  services: Record<string, Service>
}
const { app, migrate, db, redis } = stack.services as Record<string, Service>

describe("deployed Compose stack", () => {
  test("app does not start unless migrate has completed successfully", () => {
    expect(app?.depends_on?.migrate).toEqual({ condition: "service_completed_successfully" })
  })

  test("migrate runs once, after the database is healthy, and is never restarted", () => {
    expect(migrate?.command).toEqual(["bun", "cli.js", "migrate"])
    expect(migrate?.restart).toBe("no")
    expect(migrate?.depends_on?.db).toEqual({ condition: "service_healthy" })
  })

  test("one release image serves both containers", () => {
    expect(migrate?.image).toBeDefined()
    expect(app?.image).toBe(migrate?.image as string)
  })

  test("the database and Redis stay on the private network", () => {
    expect(db?.ports).toBeUndefined()
    expect(redis?.ports).toBeUndefined()
    expect(app?.environment?.POSTGRES_URL).toContain("@db:5432/")
    expect(app?.environment?.POSTGRES_URL).toBe(migrate?.environment?.POSTGRES_URL as string)
  })
})

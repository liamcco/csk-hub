import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

type Service = {
  image?: string
  command?: string[]
  restart?: string
  depends_on?: Record<string, { condition: string }>
  environment?: Record<string, string>
  ports?: string[]
  stop_grace_period?: string
}

const stack = Bun.YAML.parse(readFileSync(new URL("compose.yml", import.meta.url), "utf8")) as {
  services: Record<string, Service>
}
const { api, web, migrate, db, redis } = stack.services as Record<string, Service>
const caddyfile = readFileSync(new URL("Caddyfile", import.meta.url), "utf8")

describe("Compose stack", () => {
  test("the API does not start unless migrate has completed successfully", () => {
    expect(api?.depends_on?.migrate).toEqual({ condition: "service_completed_successfully" })
  })

  test("migrate runs once, after the database is healthy, and is never restarted", () => {
    expect(migrate?.command).toEqual(["bun", "cli.js", "migrate"])
    expect(migrate?.restart).toBe("no")
    expect(migrate?.depends_on?.db).toEqual({ condition: "service_healthy" })
  })

  test("the API image runs migrate and the API; the web image is built and versioned apart", () => {
    expect(migrate?.image).toBeDefined()
    expect(api?.image).toBe(migrate?.image as string)
    expect(api?.command).toEqual(["bun", "api.js"])
    expect(web?.image).toBeDefined()
    expect(web?.image).not.toBe(api?.image as string)
  })

  test("only the web server publishes a port; everything else stays on the private network", () => {
    for (const service of [db, redis, migrate, api]) expect(service?.ports).toBeUndefined()
    expect(web?.ports).toHaveLength(1)
    expect(Object.keys(stack.services).sort()).toEqual(["api", "db", "migrate", "redis", "web"])
  })

  test("migrate owns the schema while the API and web connect as the data-only runtime role", () => {
    const owner = migrate?.environment?.POSTGRES_URL as string
    const runtime = migrate?.environment?.POSTGRES_RUNTIME_URL as string
    expect(owner).toContain("@db:5432/")
    expect(runtime).toContain("@db:5432/")
    // Unexpanded `${...}` passwords make these invalid URLs, so read the user name directly.
    const user = (url: string) => url.match(/^postgresql:\/\/([^:]+):/)?.[1]
    expect(user(runtime)).toBeDefined()
    expect(user(runtime)).not.toBe(user(owner))
    expect(api?.environment?.POSTGRES_URL).toBe(runtime)
  })

  test("the static web server holds no application secrets", () => {
    expect(Object.keys(web?.environment ?? {})).toEqual(["SITE_ADDRESS"])
  })

  test("services reach each other by service name", () => {
    expect(api?.environment?.REDIS_URL).toBe("redis://redis:6379")
    expect(caddyfile).toMatch(/reverse_proxy api:3000/)
  })

  test("API paths go to Hono; only other paths fall back to the SPA's index.html", () => {
    expect(caddyfile).toContain("@api path /api /api/*")
    expect(caddyfile).toMatch(/handle @api \{\s*reverse_proxy api:3000/)
    const fallback = caddyfile.indexOf("try_files {path} /index.html")
    expect(fallback).toBeGreaterThan(caddyfile.indexOf("handle @api"))
    // A missing asset or file answers 404 rather than the page.
    expect(caddyfile).toMatch(/@file path_regexp [^\n]*\\\.\[/)
    expect(caddyfile).not.toMatch(/\bencode\b/)
  })

  test("event streams reach the API unbuffered, with a read timeout above the 15-second heartbeat", () => {
    const realtime = caddyfile.match(/handle \/api\/realtime\/\* \{([\s\S]*?)\n\t\}/)?.[1] ?? ""
    expect(realtime).toMatch(/reverse_proxy api:3000/)
    expect(realtime).toMatch(/flush_interval -1/)
    const timeout = Number(realtime.match(/read_timeout (\d+)s/)?.[1])
    expect(timeout).toBeGreaterThan(15)
  })

  test("the API has time to end streams and finish its delivery wave before it is killed", () => {
    expect(Number.parseInt(String(api?.stop_grace_period), 10)).toBeGreaterThanOrEqual(30)
  })
})

/**
 * Validates a running local stack through its proxy, as a browser and the iPhone companion reach
 * it. Run it with `deploy/local-stack.sh validate`, which supplies the stack's project and env file.
 *
 * Each check prints one line; the first failure exits non-zero. It creates one Admin per run
 * (`stack-check-…@example.test`) through the image's `admin bootstrap` command.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const here = fileURLToPath(new URL(".", import.meta.url))
const envFile = process.env.STACK_ENV ?? `${here}local.env`
const stackEnv = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split("\n")
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)])
)
const origin = new URL(stackEnv.BETTER_AUTH_URL ?? "https://localhost:8443").origin

class CheckFailed extends Error {}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CheckFailed(message)
}

/** fetch against the proxy; Caddy's local certificate is not in the system trust store. */
function request(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers)
  if (init.cookie) headers.set("cookie", init.cookie)
  return fetch(`${origin}${path}`, { ...init, headers, redirect: "manual", tls: { rejectUnauthorized: false } })
}

function json(path: string, method: string, body: unknown, cookie?: string, withOrigin = true) {
  return request(path, {
    method,
    cookie,
    headers: { "content-type": "application/json", ...(withOrigin ? { origin } : {}) },
    body: JSON.stringify(body)
  })
}

function cookiesFrom(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")
}

function composeExec(args: string[]) {
  const result = Bun.spawnSync(
    [
      "docker",
      "compose",
      "--project-name",
      process.env.COMPOSE_PROJECT_NAME ?? "csk-hub-local",
      "--file",
      `${here}compose.yml`,
      "--env-file",
      envFile,
      "exec",
      "-T",
      ...args
    ],
    { env: { ...process.env, CSK_HUB_IMAGE: process.env.CSK_HUB_IMAGE ?? "csk-hub:local" } }
  )
  return { code: result.exitCode, output: `${result.stdout}${result.stderr}` }
}

const checks: Array<[string, () => Promise<void>]> = []
let cookie = ""
const email = `stack-check-${crypto.randomUUID().slice(0, 8)}@example.test`
const password = `Stack-check-${crypto.randomUUID()}`

checks.push([
  "unknown API paths get the API's error, not the web app",
  async () => {
    for (const path of ["/api", "/api/does-not-exist", "/api/v1/does-not-exist"]) {
      const response = await request(path)
      check(response.status === 404, `${path} answered ${response.status}`)
      check((await response.json()).code === "NOT_FOUND", `${path} did not answer NOT_FOUND`)
    }
  }
])

checks.push([
  "web paths reach the web server",
  async () => {
    const response = await request("/login")
    check(response.status === 200, `/login answered ${response.status}`)
    check(response.headers.get("content-type")?.includes("text/html"), "/login is not HTML")
  }
])

checks.push([
  "Better Auth answers through the proxy",
  async () => {
    const response = await request("/api/auth/ok")
    check(response.status === 200, `/api/auth/ok answered ${response.status}`)
  }
])

checks.push([
  "an invited Admin activates and signs in with Better Auth",
  async () => {
    const invited = composeExec([
      "api",
      "bun",
      "cli.js",
      "admin",
      "bootstrap",
      "--email",
      email,
      "--name",
      "Stack Check"
    ])
    check(invited.code === 0, `admin bootstrap failed:\n${invited.output}`)
    const link = invited.output.match(/https?:\/\/[^\s"'\\]+\/api\/auth\/magic-link\/verify\?[^\s"'\\]+/)?.[0]
    check(link, `no magic link in the invitation:\n${invited.output}`)
    check(new URL(link).origin === origin, `the invitation links to ${new URL(link).origin}, not ${origin}`)

    const opened = await request(new URL(link).pathname + new URL(link).search)
    check(opened.status === 302, `the magic link answered ${opened.status}`)
    const linkSession = cookiesFrom(opened)
    check(linkSession, "the magic link set no session cookie")

    const activated = await json(
      "/api/v1/account/activation",
      "POST",
      { password, confirmPassword: password },
      linkSession
    )
    check(activated.status === 204, `activation answered ${activated.status}: ${await activated.text()}`)

    const signedIn = await json("/api/auth/sign-in/email", "POST", { email, password })
    check(signedIn.status === 200, `sign-in answered ${signedIn.status}: ${await signedIn.text()}`)
    cookie = cookiesFrom(signedIn)
    const me = await request("/api/v1/me", { cookie })
    check(me.status === 200, `/api/v1/me answered ${me.status}`)
    check((await me.json()).isAdmin === true, "the signed-in User is not an Admin")
  }
])

checks.push([
  "Member ID issues and verifies a code",
  async () => {
    const session = await request("/api/member-id/session", { cookie })
    check(session.status === 200, `session answered ${session.status}`)
    check(session.headers.get("cache-control")?.includes("no-store"), "Member ID session is cacheable")
    const issued = await json("/api/member-id/issue", "POST", {}, cookie)
    check(issued.status === 200, `issue answered ${issued.status}`)
    const { token } = await issued.json()
    const verified = await json("/api/member-id/verify", "POST", { token }, cookie)
    check(verified.status === 200, `verify answered ${verified.status}: ${await verified.text()}`)
  }
])

checks.push([
  "a protected write needs Hub's Origin and then applies",
  async () => {
    const foreign = await json("/api/v1/account/locale", "PUT", { locale: "en" }, cookie, false)
    check(foreign.status === 403, `a write without Origin answered ${foreign.status}`)
    const saved = await json("/api/v1/account/locale", "PUT", { locale: "en" }, cookie)
    check(saved.status === 204, `the locale write answered ${saved.status}`)
  }
])

checks.push([
  "the web server renders a protected page from the API by service name",
  async () => {
    const page = await request("/me", { cookie })
    check(page.status === 200, `/me answered ${page.status}`)
    check((await page.text()).includes("Stack Check"), "/me does not show the signed-in User")
  }
])

for (const [name, run] of checks) {
  try {
    await run()
    console.log(`✓ ${name}`)
  } catch (error) {
    console.error(`✖ ${name}\n  ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
}
console.log(`The stack at ${origin} passed every check.`)

/**
 * Validates a running local stack through its proxy, as a browser and the iPhone companion reach
 * it. Run it with `deploy/local-stack.sh validate`, which supplies the stack's project and env file.
 *
 * Each check prints one line; the first failure exits non-zero. It creates one Admin per run
 * (`stack-check-…@example.test`) through the image's `admin bootstrap` command.
 *
 * The real-time checks queue outbox records for that Admin directly in the database and control
 * the providers: there are no push subscriptions (the push fallback completes without contacting a
 * push service), and Redis is stopped and restarted. They also stop and restart the API and start
 * a second API runner for a while, so run them against a local stack only. Allow about two minutes.
 */
import { createECDH, randomBytes } from "node:crypto"
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

const project = process.env.COMPOSE_PROJECT_NAME ?? "csk-hub-local"

function compose(args: string[]) {
  const result = Bun.spawnSync(
    [
      "docker",
      "compose",
      "--project-name",
      project,
      "--file",
      `${here}compose.yml`,
      "--file",
      `${here}compose.local.yml`,
      "--env-file",
      envFile,
      ...args
    ],
    {
      env: {
        ...process.env,
        CSK_HUB_API_IMAGE: process.env.CSK_HUB_API_IMAGE ?? "csk-hub-api:local",
        CSK_HUB_WEB_IMAGE: process.env.CSK_HUB_WEB_IMAGE ?? "csk-hub-web:local"
      }
    }
  )
  const stdout = result.stdout.toString()
  return { code: result.exitCode, stdout, output: `${stdout}${result.stderr}` }
}

function composeExec(args: string[]) {
  return compose(["exec", "-T", ...args])
}

/** Runs SQL in the stack's database as the schema owner and returns its unaligned output. */
function sql(query: string) {
  const result = composeExec(["db", "psql", "-U", "csk_hub", "-d", "csk_hub", "-tAqc", query])
  check(result.code === 0, `SQL failed: ${query}\n${result.output}`)
  return result.stdout.trim()
}

async function eventually(condition: () => boolean, timeoutMs: number, message: string) {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    check(Date.now() < deadline, `${message} within ${timeoutMs / 1000} seconds`)
    await Bun.sleep(250)
  }
}

/**
 * Queues an outbox record for the checking Admin directly in the database, as a committed write
 * from any runner would, without a request that could wake delivery. A `body` makes it a
 * notification whose push is due after `pushInSeconds`; `leasedForSeconds` leaves it claimed by a
 * runner that has gone away.
 */
function enqueue({
  count = 1,
  body,
  pushInSeconds = 0,
  leasedForSeconds
}: {
  count?: number
  body?: string
  pushInSeconds?: number
  leasedForSeconds?: number
} = {}) {
  const kind = body ? "notification.created" : "unread.changed"
  const push = body ? `'${body}', now() + interval '${pushInSeconds} seconds'` : "null, null"
  const lease = leasedForSeconds ? `gen_random_uuid(), now() + interval '${leasedForSeconds} seconds'` : "null, null"
  return sql(
    `insert into activity_delivery (user_id, change, body, push_after, lease_token, lease_until)
     select '${userId}', '{"kind":"${kind}"}'::jsonb, ${push}, ${lease} from generate_series(1, ${count})
     returning id`
  ).split("\n")
}

function isPublished(ids: string[]) {
  const list = ids.map((id) => `'${id}'`).join(",")
  return (
    sql(`select count(*) from activity_delivery where id in (${list}) and published_at is not null`) === `${ids.length}`
  )
}

/** The checking Admin's event stream through the proxy, read frame by frame. */
async function openStream(lastEventId?: string) {
  const controller = new AbortController()
  const response = await request("/api/realtime/events", {
    cookie,
    headers: { "accept-encoding": "gzip, br, zstd", ...(lastEventId ? { "last-event-id": lastEventId } : {}) },
    signal: controller.signal
  })
  check(response.status === 200, `the event stream answered ${response.status}`)
  check(response.body, "the event stream has no body")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  /** Waits for the next text matching `pattern` and consumes the stream up to it. */
  async function next(pattern: RegExp, timeoutMs: number, what: string) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const match = buffer.match(pattern)
      if (match) {
        buffer = buffer.slice((match.index ?? 0) + match[0].length)
        return match
      }
      const remaining = deadline - Date.now()
      check(remaining > 0, `no ${what} within ${timeoutMs / 1000} seconds`)
      const chunk = await Promise.race([reader.read(), Bun.sleep(remaining).then(() => null)])
      if (!chunk) continue
      check(!chunk.done, `the stream closed before ${what}`)
      buffer += decoder.decode(chunk.value, { stream: true })
    }
  }
  return { response, next, close: () => controller.abort() }
}

function activityFrame(id: string) {
  return new RegExp(`id: (\\d+-\\d+)\\nevent: activity\\ndata: (\\{[^\\n]*"id":"${id}"[^\\n]*\\})\\n\\n`)
}

/** An allowed push service host name that only the stack's push sink answers to. */
const pushSinkHost = "stack-check-sink.push.services.mozilla.com"

const checks: Array<[string, () => Promise<void>]> = []
let cookie = ""
let userId = ""
/** A stream position from before the later checks, to replay from. */
let earlierCursor = ""
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
  "web paths, bookmarks and deep links get the SPA; missing files do not",
  async () => {
    const index = await (await request("/")).text()
    for (const path of ["/login", "/events", `/events/${crypto.randomUUID()}`, "/admin/users?x=1"]) {
      const response = await request(path)
      check(response.status === 200, `${path} answered ${response.status}`)
      check(response.headers.get("content-type")?.includes("text/html"), `${path} is not HTML`)
      check((await response.text()) === index, `${path} is not the SPA's index.html`)
    }
    const script = index.match(/src="(\/assets\/[^"]+\.js)"/)?.[1]
    check(script, "index.html names no script")
    const asset = await request(script)
    check(asset.status === 200, `${script} answered ${asset.status}`)
    check(asset.headers.get("cache-control")?.includes("immutable"), `${script} is not cached as immutable`)
    for (const path of ["/assets/missing.js", "/missing.png"]) {
      const response = await request(path)
      check(response.status === 404, `${path} answered ${response.status}, not 404`)
    }
    const worker = await request("/service-worker.js")
    check(worker.status === 200, `/service-worker.js answered ${worker.status}`)
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
    const actor = await me.json()
    check(actor.isAdmin === true, "the signed-in User is not an Admin")
    userId = actor.userId
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
  "a protected page's reads answer the signed-in User through the same origin",
  async () => {
    // The SPA renders /me in the browser from these reads (the journeys cover the rendering).
    const page = await request("/me", { cookie })
    check(page.status === 200, `/me answered ${page.status}`)
    const capabilities = await request("/api/v1/me/capabilities", { cookie })
    check(capabilities.status === 200, `/api/v1/me/capabilities answered ${capabilities.status}`)
    check((await capabilities.json()).user?.name === "Stack Check", "the capabilities do not name the signed-in User")
  }
])

checks.push([
  "event streams pass the proxy unbuffered and uncompressed, and outlive the heartbeat interval",
  async () => {
    const stream = await openStream()
    try {
      check(stream.response.headers.get("content-type") === "text/event-stream", "the stream is not text/event-stream")
      check(!stream.response.headers.get("content-encoding"), "the proxy compressed the event stream")
      await stream.next(/event: ready\ndata: \{"reset":(true|false)\}\n\n/, 3_000, "ready event")
      // Nothing wakes the worker: it finds the record on its own poll and the frame arrives at once.
      const [id] = enqueue()
      const frame = await stream.next(activityFrame(id as string), 15_000, "activity for the queued record")
      earlierCursor = frame[1] as string
      await stream.next(/: heartbeat\n\n/, 1_000, "heartbeat after the batch")
      // An idle stream: the next heartbeat comes after Redis blocks for 15 seconds.
      await stream.next(/: heartbeat\n\n/, 20_000, "heartbeat on an idle stream")
    } finally {
      stream.close()
    }
  }
])

checks.push([
  "an acknowledgement suppresses the push fallback, and a failed push is retried",
  async () => {
    // A controlled push provider: a container on the stack's network answers to a push service
    // host name (resolved by Docker, never on the internet) and refuses connections, so every push
    // to the subscription below fails in transport and is recorded on the subscription.
    const sink = `${project}-push-sink`
    const started = Bun.spawnSync([
      "docker",
      "run",
      "--detach",
      "--rm",
      "--name",
      sink,
      "--network",
      `${project}_default`,
      "--network-alias",
      pushSinkHost,
      "redis:7-alpine",
      "sleep",
      "300"
    ])
    check(started.exitCode === 0, `starting the push sink failed:\n${started.stderr}`)
    const ecdh = createECDH("prime256v1")
    ecdh.generateKeys()
    const subscription = sql(
      `insert into push_subscription (id, user_id, endpoint, p256dh, auth)
       values (gen_random_uuid()::text, '${userId}', 'https://${pushSinkHost}/stack-check',
         '${ecdh.getPublicKey().toString("base64url")}', '${randomBytes(16).toString("base64url")}')
       returning id`
    )
    const failures = () => Number(sql(`select failure_count from push_subscription where id = '${subscription}'`))
    const row = (id: string, column: string) => sql(`select ${column} from activity_delivery where id = '${id}'`)
    try {
      const [acknowledged] = enqueue({ body: "Stack check", pushInSeconds: 3 }) as [string]
      const foreign = await json("/api/realtime/ack", "POST", { id: acknowledged }, cookie, false)
      check(foreign.status === 403, `an acknowledgement without Origin answered ${foreign.status}`)
      const accepted = await json("/api/realtime/ack", "POST", { id: acknowledged }, cookie)
      check(accepted.status === 204, `the acknowledgement answered ${accepted.status}`)
      // Unacknowledged, the worker would wake at the push deadline and try the provider at once.
      await eventually(
        () => row(acknowledged, "published_at is not null and push_after < now() - interval '3 seconds'") === "t",
        20_000,
        "the acknowledged notification was not published, or its push deadline did not pass,"
      )
      check(failures() === 0, "the acknowledged notification still went to Web Push")

      const [unacknowledged] = enqueue({ body: "Stack check" }) as [string]
      await eventually(
        () => failures() >= 2 && row(unacknowledged, "push_completed_at is null") === "t",
        30_000,
        "the failed push was not retried"
      )
      check(row(unacknowledged, "push_after > now()") === "t", "the retry is not scheduled after a backoff")
    } finally {
      // Without a subscription the next retry settles the fallback (no active subscriptions).
      sql(`delete from push_subscription where id = '${subscription}'`)
      Bun.spawnSync(["docker", "rm", "--force", sink])
    }
  }
])

checks.push([
  "a restarted API resumes pending work and takes over an abandoned lease, with no request",
  async () => {
    const stopped = compose(["stop", "api"])
    check(stopped.code === 0, `stopping the API failed:\n${stopped.output}`)
    const exit = Bun.spawnSync(["docker", "inspect", "--format", "{{.State.ExitCode}}", `${project}-api-1`])
    check(exit.stdout.toString().trim() === "0", `the API exited with ${exit.stdout} on SIGTERM`)
    check(compose(["logs", "api"]).output.includes("realtime.worker.stopped"), "the worker did not stop cleanly")
    const pending = enqueue()
    const abandoned = enqueue({ leasedForSeconds: 5 })
    const started = compose(["start", "api"])
    check(started.code === 0, `starting the API failed:\n${started.output}`)
    await eventually(() => isPublished(pending), 20_000, "the restarted API did not resume pending work")
    await eventually(() => isPublished(abandoned), 20_000, "the abandoned lease was not taken over")
    const healthy = compose(["up", "--detach", "--wait", "api"])
    check(healthy.code === 0, `the API did not become healthy again:\n${healthy.output}`)
  }
])

checks.push([
  "two API runners deliver every record exactly once",
  async () => {
    const name = `${project}-api-second-runner`
    const second = compose(["run", "--detach", "--no-deps", "--name", name, "api"])
    check(second.code === 0, `starting a second runner failed:\n${second.output}`)
    try {
      const ids = enqueue({ count: 40 })
      await eventually(() => isPublished(ids), 30_000, "the runners did not publish every record")
      const key = `${stackEnv.REDIS_KEY_PREFIX || "csk-hub"}:activity:${new Bun.CryptoHasher("sha256").update(userId).digest("hex")}`
      const entries = composeExec(["redis", "redis-cli", "XRANGE", key, "-", "+"]).stdout.split("\n")
      for (const id of ids) {
        const copies = entries.filter((line) => line.trim() === id).length
        check(copies === 1, `record ${id} was published ${copies} times`)
      }
      const logs = Bun.spawnSync(["docker", "logs", name])
      check(`${logs.stdout}`.includes("realtime.worker.started"), "the second runner's worker did not start")
    } finally {
      Bun.spawnSync(["docker", "rm", "--force", name])
    }
  }
])

checks.push([
  "publication retries while Redis is down, and a reconnecting stream replays it",
  async () => {
    const stopped = compose(["stop", "redis"])
    check(stopped.code === 0, `stopping Redis failed:\n${stopped.output}`)
    let id = ""
    try {
      id = enqueue()[0] as string
      await eventually(
        () => sql(`select attempts > 0 and published_at is null from activity_delivery where id = '${id}'`) === "t",
        15_000,
        "the worker did not attempt publication"
      )
    } finally {
      const started = compose(["up", "--detach", "--wait", "redis"])
      check(started.code === 0, `restarting Redis failed:\n${started.output}`)
    }
    await eventually(() => isPublished([id]), 30_000, "publication was not retried after Redis came back")
    const stream = await openStream(earlierCursor)
    try {
      await stream.next(/event: ready\ndata: \{"reset":false\}\n\n/, 3_000, "a ready event resuming the cursor")
      await stream.next(activityFrame(id), 3_000, "the replayed activity")
    } finally {
      stream.close()
    }
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

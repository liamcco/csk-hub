import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { extname, join, normalize, resolve } from "node:path"
import { Readable } from "node:stream"
import { logger } from "@csk-hub/shared/core/logging"
import { getBaseURL } from "@/core/auth/base-url"
import { createAuth } from "@/core/auth/create-auth"
import { env, isProduction } from "@/core/config/env"
import { db } from "@/core/db"
import { createApiDependencies } from "@/core/http"
import { startActivityWorker } from "@/core/realtime/worker"
import { conversationActivityPolicy } from "@/features/messaging/activity"
import { createApi } from "./app"

/**
 * The standalone API on Node.js, for hosts that run Node but not Bun, such as shared hosting with
 * Phusion Passenger. It is `server.ts` with Node's HTTP server, and it also serves the web app's
 * build from `WEB_ROOT` on the same origin, routed as `deploy/Caddyfile` routes the Compose stack:
 * `/api` and `/api/*` go to the API, a path with a file extension is that file, and every other
 * path is `index.html`. Bundled to `dist/node-server.mjs` (`bun run build:node`).
 */

const worker = startActivityWorker(conversationActivityPolicy)
const shutdown = new AbortController()

const api = createApi(
  createApiDependencies({
    auth: createAuth({ database: db, baseURL: getBaseURL(env), production: isProduction }),
    database: db,
    secret: env.BETTER_AUTH_SECRET,
    scheduleDelivery: worker.wake,
    publicOrigin: new URL(env.BETTER_AUTH_URL).origin,
    shutdown: shutdown.signal
  })
)

const webRoot = process.env.WEB_ROOT ? resolve(process.env.WEB_ROOT) : undefined

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
}

/** Hands a request to the Hono app and streams its response back, unbuffered. */
async function serveApi(request: IncomingMessage, response: ServerResponse, url: URL) {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item)
    else if (value !== undefined) headers.set(name, value)
  }
  const hasBody = request.method !== "GET" && request.method !== "HEAD"
  const abort = new AbortController()
  response.once("close", () => abort.abort())
  const result = await api.fetch(
    new Request(url, {
      method: request.method,
      headers,
      body: hasBody ? (Readable.toWeb(request) as unknown as ReadableStream) : undefined,
      signal: abort.signal,
      ...(hasBody ? { duplex: "half" } : {})
    } as RequestInit)
  )
  const outgoing: Record<string, string | string[]> = {}
  result.headers.forEach((value, name) => {
    if (name !== "set-cookie") outgoing[name] = value
  })
  const cookies = result.headers.getSetCookie()
  if (cookies.length) outgoing["set-cookie"] = cookies
  response.writeHead(result.status, outgoing)
  if (!result.body) return void response.end()
  const body = Readable.fromWeb(result.body as never)
  body.on("error", () => response.destroy())
  body.pipe(response)
}

/** A file of the web build, or `index.html` for a path without an extension. */
async function serveWeb(response: ServerResponse, url: URL) {
  if (!webRoot) {
    response.writeHead(404).end()
    return
  }
  const hasExtension = /\.[A-Za-z0-9]+$/.test(url.pathname)
  const requested = normalize(join(webRoot, decodeURIComponent(url.pathname)))
  const file = hasExtension ? requested : join(webRoot, "index.html")
  const info = file.startsWith(webRoot) ? await stat(file).catch(() => undefined) : undefined
  if (!info?.isFile()) {
    response.writeHead(404).end()
    return
  }
  response.writeHead(200, {
    "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
    "content-length": info.size,
    // Hashed build output never changes under its name; everything else is revalidated.
    "cache-control": url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache"
  })
  createReadStream(file).pipe(response)
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)
  const route =
    url.pathname === "/api" || url.pathname.startsWith("/api/")
      ? serveApi(request, response, url)
      : serveWeb(response, url)
  route.catch((error: unknown) => {
    logger.error("api.request.failed", { error: error instanceof Error ? error.message : String(error) })
    if (!response.headersSent) response.writeHead(500)
    response.end()
  })
})
// Above the event stream's 15-second heartbeat, so idle streams stay open.
server.keepAliveTimeout = 60_000
server.requestTimeout = 0
server.listen(Number(process.env.PORT ?? 3000), () => logger.info("api.started", { port: process.env.PORT ?? 3000 }))

async function stop(signal: string) {
  logger.info("api.stopping", { signal })
  shutdown.abort()
  await worker.stop()
  await new Promise((done) => server.close(done))
  await db.$client.end().catch(() => {})
  process.exit(0)
}

process.once("SIGTERM", () => void stop("SIGTERM"))
process.once("SIGINT", () => void stop("SIGINT"))

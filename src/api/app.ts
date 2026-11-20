import { type ApiDependencies, apiError, createRouter, handleApiError } from "@/core/http"
import { memberIdRouter } from "@/features/member-id"
import { membersRouter } from "@/features/members/http"
import { messagingRouter } from "@/features/messaging/http"
import { postsRouter } from "@/features/posts/http"
import { currentActorRouter } from "./current-actor"

const openApiInfo = {
  title: "CSK Hub API",
  version: "1.0.0",
  description: "Authentication endpoints under /api/auth belong to Better Auth and are used through its client."
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

function isSameOrigin(origin: string | undefined, url: string) {
  if (!origin) return false
  try {
    return new URL(origin).host === new URL(url).host
  } catch {
    return false
  }
}

/**
 * Assembles the HTTP API from feature routers. Pure: it opens no listener and touches no
 * dependency until a request arrives, so tests and the contract export can call it freely.
 *
 * Add a feature by exporting a `createRouter()` router from its public entrypoint and mounting it
 * below under `/api/v1`.
 */
export function createApi(dependencies: ApiDependencies) {
  const api = createRouter()

  api.on(["GET", "POST"], "/api/auth/*", (c) => dependencies.handleAuth(c.req.raw))

  api.use("/api/*", async (c, next) => {
    c.set("resolveRequest", () => dependencies.resolveRequest(c.req.raw.headers))
    c.set("database", dependencies.database)
    c.set("secret", dependencies.secret)
    c.set("scheduleDelivery", dependencies.scheduleDelivery)
    await next()
  })

  api.use("/api/v1/*", async (c, next) => {
    await next()
    // Every operation is personalised by the caller's session; nothing may be shared-cached.
    c.header("Cache-Control", "private, no-store")
  })

  api.use("/api/v1/*", async (c, next) => {
    // Session cookies authenticate these requests, so state changes must come from Hub itself:
    // browsers send Origin on unsafe requests, and Hub's own servers and apps set it.
    if (!SAFE_METHODS.has(c.req.method) && !isSameOrigin(c.req.header("origin"), c.req.url)) {
      return apiError(c, 403, "FORBIDDEN")
    }
    await next()
  })

  const v1 = createRouter()
    .route("/", currentActorRouter)
    .route("/", membersRouter)
    .route("/", postsRouter)
    .route("/", messagingRouter)
  api.route("/api/v1", v1)
  // Released before /api/v1; its paths and representations stay frozen for installed clients.
  api.route("/api/member-id", memberIdRouter)

  api.notFound((c) => apiError(c, 404, "NOT_FOUND"))
  api.onError(handleApiError)

  return api
}

export type Api = ReturnType<typeof createApi>

/** The OpenAPI 3.0.3 contract generated from the routes' schemas. */
export function getApiContract(api: Api) {
  return api.getOpenAPIDocument({ openapi: "3.0.3", info: openApiInfo })
}

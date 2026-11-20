import { describe, expect, test } from "bun:test"
import { AuthorizationDeniedError, type RequestAuthorization } from "@/core/authz/authorization"
import { evaluatePermission } from "@/core/authz/policy-registry"
import type { Database } from "@/core/db"
import type { ApiDependencies } from "@/core/http"
import { createApi, getApiContract } from "./app"

function authorizationFor(actor: RequestAuthorization["actor"]): RequestAuthorization {
  return {
    actor,
    can: (request) => evaluatePermission(actor, request),
    requirePermission: (request) => {
      if (!actor || !evaluatePermission(actor, request)) throw new AuthorizationDeniedError(request, actor)
      return actor
    }
  }
}

function unavailable(): never {
  throw new Error("Assembly must not touch request dependencies")
}

const offline = {
  handleAuth: unavailable,
  resolveRequest: unavailable,
  database: new Proxy({} as Database, { get: unavailable }),
  secret: "unused",
  scheduleDelivery: unavailable,
  authApi: new Proxy({} as ApiDependencies["authApi"], { get: unavailable })
}

describe("API assembly", () => {
  test("assembles and exports its contract without request dependencies", async () => {
    const api = createApi(offline)
    const document = getApiContract(api)

    expect(document.openapi).toBe("3.0.3")
    expect(document.paths["/api/v1/me"]?.get?.operationId).toBe("getCurrentActor")
  })

  test("matches the committed contract", async () => {
    const committed = await Bun.file("contract/openapi.json").json()
    const api = createApi(offline)

    // On failure, run `bun run api:generate` and commit the contract and client.
    expect(JSON.parse(JSON.stringify(getApiContract(api)))).toEqual(committed)
  })

  test("delegates every auth URL to Better Auth unchanged", async () => {
    const seen: string[] = []
    const api = createApi({
      ...offline,
      handleAuth: async (request) => {
        seen.push(`${request.method} ${new URL(request.url).pathname} ${request.headers.get("cookie")}`)
        return new Response("from auth", { status: 299, headers: { "set-cookie": "better-auth.session_token=x" } })
      },
      resolveRequest: unavailable
    })

    const response = await api.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { cookie: "a=1" },
      body: "{}"
    })
    await api.request("/api/auth/get-session")

    expect(response.status).toBe(299)
    expect(await response.text()).toBe("from auth")
    expect(response.headers.get("set-cookie")).toBe("better-auth.session_token=x")
    expect(seen).toEqual(["POST /api/auth/sign-in/email a=1", "GET /api/auth/get-session null"])
  })

  test("answers a signed-out caller with a stable error code and no shared caching", async () => {
    const api = createApi({
      ...offline,
      resolveRequest: async () => ({ authorization: authorizationFor(null), impersonatedBy: null, sessionId: null })
    })

    const response = await api.request("/api/v1/me")

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ code: "UNAUTHENTICATED" })
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })

  test("returns the current actor's trusted facts", async () => {
    const api = createApi({
      ...offline,
      resolveRequest: async () => ({
        authorization: authorizationFor({ userId: "user-1", isAdmin: true }),
        impersonatedBy: "admin-2",
        sessionId: "session-1"
      })
    })

    const response = await api.request("/api/v1/me")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ userId: "user-1", isAdmin: true, impersonatedBy: "admin-2" })
  })

  test("answers unknown API paths with a stable error code", async () => {
    const api = createApi(offline)

    const response = await api.request("/api/v1/does-not-exist")

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ code: "NOT_FOUND" })
  })

  test("behind the proxy, accepts writes only from the configured public origin", async () => {
    // The web server reaches the API by service name and forwards the browser's public Origin.
    const api = createApi({ ...offline, publicOrigin: "https://hub.example" })
    function write(origin: string) {
      return api.request("http://api:3000/api/v1/does-not-exist", { method: "POST", headers: { origin } })
    }

    expect((await write("https://hub.example")).status).toBe(404)
    expect((await write("http://api:3000")).status).toBe(403)
    expect((await write("https://hub.example.evil")).status).toBe(403)
  })
})

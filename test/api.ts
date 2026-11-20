import { expect } from "bun:test"
import { eq } from "drizzle-orm"
import { createApi } from "@/api/app"
import { createAuth } from "@/core/auth/create-auth"
import { user } from "@/core/db/schema/auth"
import { createApiDependencies } from "@/core/http"
import { createClient } from "../contract/client/client"
import type { TestDatabase } from "./database"

export const testOrigin = "http://localhost:3000"
const password = "api-test-password"
const secret = "api-disposable-test-secret"

export type TestMember = { id: string; email: string; name: string }

/**
 * The real API over a disposable database, signed in through Better Auth like a browser. Requests
 * carry the Hub `Origin`, as the web app and native clients do.
 */
export function createApiHarness(database: TestDatabase) {
  const auth = createAuth({ database: database.db, baseURL: testOrigin, production: false, secret })
  const api = createApi(createApiDependencies({ auth, database: database.db, secret }))

  async function createMember({
    role = "user",
    name = "Singer",
    username
  }: {
    role?: "user" | "admin"
    name?: string
    username?: string
  } = {}): Promise<TestMember> {
    const email = `${crypto.randomUUID()}@example.test`
    const created = await auth.api.createUser({
      body: { email, password, name, role, data: username ? { username } : {} }
    })
    return { id: created.user.id, email, name }
  }

  async function signIn(member: TestMember | string) {
    const email = typeof member === "string" ? member : member.email
    const response = await api.request(`${testOrigin}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { origin: testOrigin, "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    })
    expect(response.status).toBe(200)
    return response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ")
  }

  /** The generated TypeScript client, sending the session cookie as the web app's server does. */
  function client(cookie?: string) {
    return createClient({
      baseUrl: testOrigin,
      headers: { origin: testOrigin, ...(cookie ? { cookie } : {}) },
      fetch: ((input, init) => api.request(input, init)) as typeof fetch
    })
  }

  async function signedIn(options?: Parameters<typeof createMember>[0]) {
    const member = await createMember(options)
    const cookie = await signIn(member)
    return { member, cookie, client: client(cookie) }
  }

  /** Changes a User's authority behind the API's back, as another Admin's command would. */
  async function setAccount(userId: string, values: { role?: "user" | "admin"; banned?: boolean }) {
    await database.db.update(user).set(values).where(eq(user.id, userId))
  }

  function request(
    path: string,
    init: { method?: string; cookie?: string; body?: unknown; origin?: string | null } = {}
  ) {
    const headers: Record<string, string> = {}
    if (init.origin !== null) headers.origin = init.origin ?? testOrigin
    if (init.cookie) headers.cookie = init.cookie
    if (init.body !== undefined) headers["content-type"] = "application/json"
    return api.request(`${testOrigin}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    })
  }

  return { api, auth, db: database.db, createMember, signIn, client, signedIn, setAccount, request }
}

export type ApiHarness = ReturnType<typeof createApiHarness>

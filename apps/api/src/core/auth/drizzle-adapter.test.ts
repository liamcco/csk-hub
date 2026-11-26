import { afterAll, describe, expect, test } from "bun:test"
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2"
import { betterAuth } from "better-auth"
import { isMariaDb } from "@/core/db/dialect"
import * as schema from "@/core/db/schema/auth"
import { createTestDatabase } from "../../../test/database"

const database = await createTestDatabase()

describe.skipIf(!database)("Drizzle v1 auth persistence", () => {
  const t = database as NonNullable<typeof database>
  afterAll(() => t.drop())

  // Drizzle's relational queries, which joins=true uses, need LATERAL, which MariaDB lacks; the
  // application keeps joins off.
  for (const joins of isMariaDb ? [false] : [false, true]) {
    test(`creates an account, signs in and reads its session with joins=${joins}`, async () => {
      const auth = betterAuth({
        baseURL: "http://localhost:3000",
        secret: "drizzle-adapter-integration-test-secret",
        database: drizzleAdapter(t.db, { provider: isMariaDb ? "mysql" : "pg", schema }),
        emailAndPassword: { enabled: true },
        advanced: { database: { joins } }
      })
      const email = `${crypto.randomUUID()}@example.com`
      const password = "drizzle-adapter-test-password"
      const account = await auth.api.signUpEmail({ body: { name: "Singer", email, password } })
      const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true })
      expect(response.status).toBe(200)

      const cookie = response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ")
      const session = await auth.handler(
        new Request("http://localhost:3000/api/auth/get-session", { headers: { cookie } })
      )
      expect(session.status).toBe(200)
      expect(await session.json()).toMatchObject({ user: { id: account.user.id, email } })
    })
  }
})

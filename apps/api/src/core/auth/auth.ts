import { nextCookies } from "better-auth/next-js"
import { env, isProduction } from "@/core/config/env"
import { db } from "@/core/db"
import { getBaseURL } from "./base-url"
import { createAuth } from "./create-auth"

/** The Next.js host's instance; nextCookies lets Server Actions set auth cookies. */
export const auth = createAuth({
  database: db,
  baseURL: getBaseURL(env),
  production: isProduction,
  hostPlugins: [nextCookies()]
})

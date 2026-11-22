import type { BetterAuthOptions } from "better-auth"

type BaseURLEnvironment = {
  ENVIRONMENT: "development" | "test" | "preview" | "production"
  BETTER_AUTH_URL: string
  VERCEL_URL?: string
  VERCEL_BRANCH_URL?: string
}

export function getBaseURL(environment: BaseURLEnvironment): NonNullable<BetterAuthOptions["baseURL"]> {
  if (environment.ENVIRONMENT !== "preview") return environment.BETTER_AUTH_URL

  // Vercel preview deployments have no fixed origin, so Better Auth accepts the deployment's
  // hostname (and the branch alias, when set) and falls back to the deployment URL. Vercel
  // injects VERCEL_URL; the Docker stack never runs with ENVIRONMENT=preview.
  if (!environment.VERCEL_URL) {
    throw new Error("VERCEL_URL is required for preview deployments")
  }

  return {
    allowedHosts: [environment.VERCEL_URL, ...(environment.VERCEL_BRANCH_URL ? [environment.VERCEL_BRANCH_URL] : [])],
    fallback: `https://${environment.VERCEL_URL}`,
    protocol: "https"
  }
}

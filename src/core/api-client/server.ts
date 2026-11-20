import "server-only"

import { createClient } from "@contract/client/client"
import { io } from "next/cache"
import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { getBaseURL } from "@/core/auth/base-url"
import { env } from "@/core/config/env"
import { loginPath } from "@/core/navigation/navigation-utils"
import { ApiRequestError, type ApiResult } from "./result"

function apiOrigin() {
  const baseURL = getBaseURL(env)
  // Never derive this from the request's Host header: the caller's cookie travels with it.
  return typeof baseURL === "string" ? baseURL : (baseURL.fallback ?? env.BETTER_AUTH_URL)
}

/**
 * The generated API client for server components and temporary Server Action adapters. It calls
 * Hub's own HTTP API with the incoming request's cookie, exactly as the browser would, so the web
 * application never reaches the database or feature services directly. Responses are never cached:
 * each one is personalised by the caller's session.
 */
export async function getServerApiClient() {
  const incoming = await headers()
  // Headers resolve during runtime prerender; the API call itself must wait for the request.
  await io()
  const origin = new URL(apiOrigin()).origin
  const cookie = incoming.get("cookie")
  return createClient({
    baseUrl: origin,
    cache: "no-store",
    headers: { origin, ...(cookie ? { cookie } : {}) }
  })
}

/**
 * Unwraps a read for a server-rendered screen: signed-out callers go to login, and refused or
 * missing resources render the not-found page, as the screens did before the API existed.
 */
export async function readForScreen<T>(call: Promise<ApiResult<T>>, returnTo?: string): Promise<T> {
  const { data, error, response } = await call
  const status = response?.status ?? 0
  if (data !== undefined && response?.ok) return data
  if (status === 401) redirect(loginPath(returnTo))
  if (status === 403 || status === 404) notFound()
  throw new ApiRequestError(status, error)
}

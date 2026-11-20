import "server-only"

import { type CurrentCapabilities, getCurrentCapabilities } from "@contract/client"
import { notFound } from "next/navigation"
import { cache } from "react"
import { ApiRequestError } from "./result"
import { getServerApiClient } from "./server"

/**
 * The signed-in User's capabilities for this render, or null when signed out or inactive. React's
 * cache scopes it to one request, so permissions are never shared between Users or requests.
 */
export const getCapabilities = cache(async (): Promise<CurrentCapabilities | null> => {
  const { data, error, response } = await getCurrentCapabilities({ client: await getServerApiClient() })
  if (data) return data
  if (response?.status === 401) return null
  throw new ApiRequestError(response?.status ?? 0, error)
})

/**
 * A page-level gate for administration screens. It only hides the page; every API operation the
 * page uses enforces authority again.
 */
export async function requireCapability(permission: keyof CurrentCapabilities["permissions"]) {
  const capabilities = await getCapabilities()
  if (!capabilities?.permissions[permission]) notFound()
  return capabilities
}

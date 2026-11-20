/** The shape every generated SDK function resolves to when it does not throw. */
export type ApiResult<T> = { data?: T; error?: unknown; response?: Response }

/** An API failure the caller did not expect. Carries only the status and stable error code. */
export class ApiRequestError extends Error {
  readonly code: string | null

  constructor(
    readonly status: number,
    error: unknown
  ) {
    const code = errorCode(error)
    super(`API request failed with ${status}${code ? ` ${code}` : ""}.`)
    this.name = "ApiRequestError"
    this.code = code
  }
}

/** The stable `code` of an API error body, or null when there is none. */
export function errorCode(error: unknown): string | null {
  if (typeof error === "object" && error && "code" in error && typeof error.code === "string") return error.code
  return null
}

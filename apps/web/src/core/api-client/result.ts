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

/**
 * The feature failure kind an API error code names, for translating it: `GROUP_NAME_TAKEN` is
 * `group-name-taken`. Null when the body carries no code. Callers decide which kinds they know.
 */
export function errorKind(error: unknown): string | null {
  return errorCode(error)?.toLowerCase().replaceAll("_", "-") ?? null
}

/**
 * Unwraps a read for a query: the data, or an `ApiRequestError` carrying the status, which the
 * router turns into the login redirect (401) or the not-found screen (403 and 404).
 */
export async function read<T>(call: Promise<ApiResult<T>>): Promise<T> {
  const { data, error, response } = await call
  if (data !== undefined && response?.ok) return data
  throw new ApiRequestError(response?.status ?? 0, error)
}

/** Whether a failed read means the caller is signed out or no longer active. */
export function isUnauthenticated(error: unknown) {
  return error instanceof ApiRequestError && error.status === 401
}

/** Whether a failed read means the resource is missing or not the caller's to see. */
export function isUnavailable(error: unknown) {
  return error instanceof ApiRequestError && (error.status === 403 || error.status === 404)
}

/** The data a query's options resolve to, for naming a screen's types after its query. */
export type QueryData<Options> = Options extends { queryFn?: infer Fn }
  ? Awaited<ReturnType<Extract<Fn, (...args: never[]) => unknown>>>
  : never

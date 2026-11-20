import { api } from "@/api/runtime"

/** Temporary host for the Hono API, including Better Auth under /api/auth, until the standalone API. */
function handle(request: Request) {
  return api.fetch(request)
}

export { handle as DELETE, handle as GET, handle as PATCH, handle as POST, handle as PUT }

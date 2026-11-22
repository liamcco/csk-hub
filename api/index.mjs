// Vercel-only entry point. Vercel's Function builder traces this file as the API handler for
// /api/*, so it must exist at this path. The bundle it imports is produced by the root
// `vercel-build` script (see vercel.json). The Docker stack does not use this file; it runs
// apps/api/src/api/server.ts.
import { api } from "../apps/api/dist/vercel.mjs"

export default { fetch: api.fetch }

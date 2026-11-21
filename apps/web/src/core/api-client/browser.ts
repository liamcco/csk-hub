import { createClient } from "@csk-hub/contract/client/client"

/**
 * The generated API client for browser code. Requests go to the page's own origin with the session
 * cookie; the browser sets `Origin` on writes, which the API requires.
 */
export const browserApiClient = createClient({ baseUrl: "", credentials: "same-origin", cache: "no-store" })

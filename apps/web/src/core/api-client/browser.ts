import { type Client, createClient } from "@csk-hub/contract/client/client"

/**
 * The generated API client for browser code. Requests go to the page's own origin with the session
 * cookie; the browser sets `Origin` on writes, which the API requires.
 */
export const browserApiClient = createClient({ baseUrl: "", credentials: "same-origin", cache: "no-store" })

/**
 * Calls `onUnauthenticated` when a command (any request but a GET) answers 401: the session ended
 * or the account changed status. Reads answering 401 reach the query cache instead
 * (`createQueryClient`), which reloads the session only for reads on screen.
 */
export function reloadSessionOnUnauthenticatedCommand(client: Client, onUnauthenticated: () => void) {
  client.interceptors.response.use((response, request) => {
    if (response.status === 401 && request.method !== "GET") onUnauthenticated()
    return response
  })
}

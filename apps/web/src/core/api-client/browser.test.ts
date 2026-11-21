import { describe, expect, test } from "bun:test"
import { changeUserRoles, getCurrentCapabilities } from "@csk-hub/contract/client"
import { createClient } from "@csk-hub/contract/client/client"
import { reloadSessionOnUnauthenticatedCommand } from "./browser"

function clientAnswering(status: number) {
  return createClient({
    baseUrl: "http://hub.test",
    fetch: Object.assign(
      async () => Response.json({ code: status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN" }, { status }),
      { preconnect: fetch.preconnect }
    )
  })
}

describe("reloadSessionOnUnauthenticatedCommand", () => {
  test("a command answering 401 reloads the session", async () => {
    const client = clientAnswering(401)
    let reloads = 0
    reloadSessionOnUnauthenticatedCommand(client, () => reloads++)

    await changeUserRoles({ client, path: { userId: "u1" }, body: { roles: [] } })

    expect(reloads).toBe(1)
  })

  test("a read answering 401 is left to the query cache", async () => {
    const client = clientAnswering(401)
    let reloads = 0
    reloadSessionOnUnauthenticatedCommand(client, () => reloads++)

    await getCurrentCapabilities({ client })

    expect(reloads).toBe(0)
  })

  test("a refused command does not reload the session", async () => {
    const client = clientAnswering(403)
    let reloads = 0
    reloadSessionOnUnauthenticatedCommand(client, () => reloads++)

    await changeUserRoles({ client, path: { userId: "u1" }, body: { roles: [] } })

    expect(reloads).toBe(0)
  })
})

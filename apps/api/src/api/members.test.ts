import { afterAll, describe, expect, test } from "bun:test"
import {
  getMemberProfile,
  getOwnProfile,
  getProfileEditor,
  listMembers,
  updateProfileVoices
} from "@csk-hub/contract/client"
import { group, groupMember } from "@/core/db/schema/org-structure"
import { createApiHarness } from "../../test/api"
import { createTestDatabase } from "../../test/database"

const database = await createTestDatabase()

describe.skipIf(!database)("Member directory and profiles over HTTP", () => {
  const t = database as NonNullable<typeof database>
  afterAll(() => t.drop())
  const h = createApiHarness(t)

  async function joinChoir(userId: string, name: string) {
    const [choir] = await t.db.insert(group).values({ name, type: "Choir" }).returning({ id: group.id })
    await t.db.insert(groupMember).values({ userId, groupId: choir.id, startDate: "2026-01-01" })
    return choir.id
  }

  test("lists other active members with their Choirs, searching by name", async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    const viewer = await h.signedIn({ name: `Viewer ${tag}` })
    const alto = await h.createMember({ name: `Alto ${tag}` })
    const choirId = await joinChoir(alto.id, `Choir ${tag}`)
    const inactive = await h.createMember({ name: `Gone ${tag}` })
    await h.setAccount(inactive.id, { banned: true })

    const { data, response } = await listMembers({ client: viewer.client, query: { query: tag } })

    expect(response?.status).toBe(200)
    expect(response?.headers.get("cache-control")).toBe("private, no-store")
    expect(data).toEqual({
      query: tag,
      page: 1,
      totalPages: 1,
      total: 1,
      items: [
        {
          id: alto.id,
          name: `Alto ${tag}`,
          username: null,
          image: null,
          choirs: [{ id: choirId, name: `Choir ${tag}`, section: null }]
        }
      ]
    })
  })

  test("pages the directory deterministically", async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    const viewer = await h.signedIn()
    for (let index = 0; index < 25; index++) {
      await h.createMember({ name: `Paged ${tag} ${String(index).padStart(2, "0")}` })
    }

    const second = await listMembers({ client: viewer.client, query: { query: `Paged ${tag}`, page: 2 } })

    expect(second.data?.page).toBe(2)
    expect(second.data?.totalPages).toBe(2)
    expect(second.data?.items.map((member) => member.name)).toEqual([`Paged ${tag} 24`])
  })

  test("returns another member's profile without their email and with the viewer's permissions", async () => {
    const viewer = await h.signedIn()
    const member = await h.createMember({ name: "Tenor Tor" })

    const { data, response } = await getMemberProfile({ client: viewer.client, path: { memberId: member.id } })

    expect(response?.status).toBe(200)
    expect(data?.profile).toMatchObject({ id: member.id, name: "Tenor Tor", email: null, isOwn: false })
    expect(data?.permissions).toEqual({ editProfile: false, message: true })
    expect(data?.messageConversationId).toBeNull()
  })

  test("returns the caller's own profile with their email and edit permission", async () => {
    const viewer = await h.signedIn({ name: "Own Olga" })

    const { data } = await getOwnProfile({ client: viewer.client })

    expect(data?.profile).toMatchObject({ id: viewer.member.id, email: viewer.member.email, isOwn: true })
    expect(data?.permissions).toEqual({ editProfile: true, message: false })
  })

  test("hides inactive and unknown members behind 404", async () => {
    const viewer = await h.signedIn()
    const inactive = await h.createMember()
    await h.setAccount(inactive.id, { banned: true })

    for (const memberId of [inactive.id, "missing"]) {
      const { error, response } = await getMemberProfile({ client: viewer.client, path: { memberId } })
      expect(response?.status).toBe(404)
      expect(error).toEqual({ code: "NOT_FOUND" })
    }
  })

  test("saves the caller's voices and shows them on the profile", async () => {
    const viewer = await h.signedIn()

    const saved = await updateProfileVoices({ client: viewer.client, body: { voices: ["T2", "B1"] } })
    const editor = await getProfileEditor({ client: viewer.client })
    const profile = await getOwnProfile({ client: viewer.client })

    expect(saved.data).toEqual({ voices: ["T2", "B1"] })
    expect(editor.data).toEqual({ voices: ["T2", "B1"] })
    expect(profile.data?.profile.capabilities).toEqual(["T2", "B1"])
  })

  test("refuses undeclared voices", async () => {
    const viewer = await h.signedIn()

    const { response, error } = await updateProfileVoices({
      client: viewer.client,
      body: { voices: ["B3"] as unknown as ["B1"] }
    })

    expect(response?.status).toBe(400)
    expect(error).toMatchObject({ code: "VALIDATION_FAILED" })
  })

  test("refuses a profile edit without the caller's own Origin", async () => {
    const viewer = await h.signedIn()

    const crossSite = await h.request("/api/v1/profile/voices", {
      method: "PUT",
      cookie: viewer.cookie,
      origin: "https://evil.example",
      body: { voices: ["B1"] }
    })
    const missing = await h.request("/api/v1/profile/voices", {
      method: "PUT",
      cookie: viewer.cookie,
      origin: null,
      body: { voices: ["B1"] }
    })

    expect(crossSite.status).toBe(403)
    expect(missing.status).toBe(403)
    expect((await getProfileEditor({ client: viewer.client })).data).toEqual({ voices: [] })
  })

  test("applies a deactivation to the very next request", async () => {
    const viewer = await h.signedIn()
    expect((await getOwnProfile({ client: viewer.client })).response?.status).toBe(200)

    await h.setAccount(viewer.member.id, { banned: true })

    for (const result of [
      await getOwnProfile({ client: viewer.client }),
      await listMembers({ client: viewer.client }),
      await updateProfileVoices({ client: viewer.client, body: { voices: ["B1"] } })
    ]) {
      expect(result.response?.status).toBe(401)
      expect(result.error).toEqual({ code: "UNAUTHENTICATED" })
    }
  })

  test("refuses signed-out callers", async () => {
    const { response } = await listMembers({ client: h.client() })

    expect(response?.status).toBe(401)
  })
})

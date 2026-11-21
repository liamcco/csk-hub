import { afterAll, describe, expect, test } from "bun:test"
import {
  addGroupMember,
  archiveGroup,
  assignPositionHolder,
  changeSingerVoice,
  createGroup,
  createPosition,
  endGroupMembership,
  endPositionHolding,
  getChoirPlacement,
  getGroupDetail,
  getGroupsOverview,
  listPositionCatalogue,
  renameGroup,
  updatePosition
} from "@csk-hub/contract/client"
import { createApiHarness } from "../../test/api"
import { createOrgStructureTestDatabase } from "../features/org-structure/test-support"

const database = await createOrgStructureTestDatabase()

describe.skipIf(!database)("Groups, Memberships and Positions over HTTP", () => {
  const t = database as NonNullable<typeof database>
  afterAll(() => t.drop())
  const h = createApiHarness(t)

  test("keeps the organisation to Admins, and a demoted Admin loses it on the next request", async () => {
    const admin = await h.signedIn({ role: "admin" })
    const member = await h.signedIn()

    const placement = await getChoirPlacement({ client: admin.client })
    expect(placement.data?.choirs.map(({ choir }) => choir.name)).toEqual(expect.arrayContaining(["DK", "KK", "MK"]))
    expect(placement.data?.choirs.find(({ choir }) => choir.name === "KK")?.sections.map(({ name }) => name)).toEqual([
      "KKS",
      "KKA",
      "KKT",
      "KKB"
    ])
    expect((await getChoirPlacement({ client: member.client })).response?.status).toBe(403)
    expect((await createGroup({ client: member.client, body: { name: "Mine", type: "Board" } })).response?.status).toBe(
      403
    )

    await h.setAccount(admin.member.id, { role: "user" })
    expect((await getGroupsOverview({ client: admin.client })).response?.status).toBe(403)
  })

  test("creates, renames and archives a group, and reports the rule a command breaks", async () => {
    const admin = await h.signedIn({ role: "admin" })

    const created = await createGroup({ client: admin.client, body: { name: "Arbetsgruppen", type: "Valberedning" } })
    expect(created.response?.status).toBe(201)
    const groupId = created.data?.id ?? ""
    expect((await renameGroup({ client: admin.client, path: { groupId }, body: { name: "Valet" } })).data).toEqual({
      id: groupId
    })
    expect((await getGroupsOverview({ client: admin.client })).data?.cskWide).toContainEqual(
      expect.objectContaining({ id: groupId, name: "Valet", active: true })
    )
    expect((await archiveGroup({ client: admin.client, path: { groupId } })).data).toEqual({ id: groupId })
    expect((await getGroupDetail({ client: admin.client, path: { groupId } })).data?.group).toMatchObject({
      name: "Valet",
      active: false
    })

    const taken = await createGroup({ client: admin.client, body: { name: "Styret", type: "Board" } })
    expect(taken.response?.status).toBe(400)
    expect(taken.error).toEqual({ code: "GROUP_NAME_TAKEN" })
    const choir = await createGroup({ client: admin.client, body: { name: "Ny kör", type: "Choir" as "Board" } })
    expect(choir.response?.status).toBe(400)
    expect(
      (await getGroupDetail({ client: admin.client, path: { groupId: crypto.randomUUID() } })).response?.status
    ).toBe(404)
  })

  test("places a singer in a Section, changes their Voice and gives them a Position", async () => {
    const admin = await h.signedIn({ role: "admin" })
    const singer = await h.createMember({ name: "Basso Bo" })
    const [mk, mkb2] = [await t.groupId("MK"), await t.groupId("MKB2")]

    const added = await addGroupMember({
      client: admin.client,
      path: { groupId: mkb2 },
      body: { userId: singer.id, voice: "B2", startDate: "2024-08-25" }
    })
    expect(added.data).toEqual({ id: mkb2 })
    expect((await getGroupDetail({ client: admin.client, path: { groupId: mk } })).data?.members).toContainEqual(
      expect.objectContaining({ userId: singer.id, voice: "B2" })
    )

    const wrongVoice = await addGroupMember({
      client: admin.client,
      path: { groupId: await t.groupId("KKB") },
      body: { userId: singer.id, voice: "T1", startDate: "2025-08-25" }
    })
    expect(wrongVoice.error).toEqual({ code: "VOICE_NOT_SUNG_IN_SECTION" })

    expect(
      (
        await changeSingerVoice({
          client: admin.client,
          path: { groupId: mkb2, userId: singer.id },
          body: { voice: "B1", date: "2025-08-25" }
        })
      ).data
    ).toEqual({ id: mkb2 })

    const notfiskal = await t.positionId("Notfiskal")
    const assigned = await assignPositionHolder({
      client: admin.client,
      path: { groupId: mk, positionId: notfiskal },
      body: { userId: singer.id, startDate: "2025-09-01" }
    })
    expect(assigned.data).toEqual({ id: mk })
    const detail = await getGroupDetail({ client: admin.client, path: { groupId: mk } })
    expect(detail.data?.positions.find(({ id }) => id === notfiskal)?.holder).toMatchObject({ userId: singer.id })

    expect(
      (
        await endPositionHolding({
          client: admin.client,
          path: { groupId: mk, positionId: notfiskal },
          body: { userId: singer.id, endDate: "2025-12-31" }
        })
      ).data
    ).toEqual({ id: mk })
    expect(
      (
        await endGroupMembership({
          client: admin.client,
          path: { groupId: mk, userId: singer.id },
          body: { endDate: "2026-06-30" }
        })
      ).data
    ).toEqual({ id: mk })
    const outsider = await assignPositionHolder({
      client: admin.client,
      path: { groupId: mk, positionId: notfiskal },
      body: { userId: (await h.createMember()).id, startDate: "2026-07-01" }
    })
    expect(outsider.error).toEqual({ code: "NOT_A_MEMBER" })
  })

  test("creates and edits Positions in the catalogue", async () => {
    const admin = await h.signedIn({ role: "admin" })
    const board = await t.groupId("Styret")

    const created = await createPosition({
      client: admin.client,
      body: { name: "Kassör", groupTypes: ["Board"], groupIds: [] }
    })
    expect(created.response?.status).toBe(201)
    const positionId = created.data?.id ?? ""
    expect(
      (await createPosition({ client: admin.client, body: { name: "Kassör", groupTypes: [], groupIds: [] } })).error
    ).toEqual({
      code: "POSITION_NAME_TAKEN"
    })

    const updated = await updatePosition({
      client: admin.client,
      path: { positionId },
      body: { name: "Skattmästare", groupTypes: ["Board"], groupIds: [board] }
    })
    expect(updated.data).toEqual({ id: positionId })
    const catalogue = await listPositionCatalogue({ client: admin.client })
    expect(catalogue.data?.positions).toContainEqual({
      id: positionId,
      name: "Skattmästare",
      groupTypes: ["Board"],
      groups: [{ id: board, name: "Styret", type: "Board", choirName: null }]
    })
  })
})

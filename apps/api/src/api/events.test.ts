import { afterAll, describe, expect, test } from "bun:test"
import {
  archiveLocation,
  changeEventStatus,
  createEvent,
  createLocation,
  deleteEvent,
  type EventInput,
  getEventEditor,
  getEventPage,
  listLocations,
  listManagedEvents,
  listUpcomingEvents
} from "@csk-hub/contract/client"
import { group, groupMember } from "@/core/db/schema/org-structure"
import { createApiHarness } from "../../test/api"
import { createTestDatabase } from "../../test/database"

const database = await createTestDatabase()

/** A timed Event next year, in Stockholm wall-clock time, as the Event form submits it. */
function eventForm(title: string, overrides: Partial<EventInput> = {}): EventInput {
  const year = new Date().getFullYear() + 1
  return {
    type: "Meeting",
    title,
    schedule: { allDay: false, startsAt: `${year}-03-01T18:00`, endsAt: `${year}-03-01T20:00` },
    participationMode: "None",
    rehearsal: {},
    gig: {},
    social: {},
    targets: [],
    details: [],
    ...overrides
  }
}

describe.skipIf(!database)("Events and Locations over HTTP", () => {
  const t = database as NonNullable<typeof database>
  afterAll(() => t.drop())
  const h = createApiHarness(t)

  async function choirWith(...userIds: string[]) {
    const [choir] = await t.db
      .insert(group)
      .values({ name: `Choir ${crypto.randomUUID().slice(0, 8)}`, type: "Choir" })
      .returning({ id: group.id })
    for (const userId of userIds) {
      await t.db.insert(groupMember).values({ userId, groupId: choir.id, startDate: "2020-01-01" })
    }
    return choir.id
  }

  test("a Draft stays out of the Audience's calendar until it is published, and stays listed once cancelled", async () => {
    const admin = await h.signedIn({ role: "admin" })
    const singer = await h.signedIn()
    const outsider = await h.signedIn()
    const choirId = await choirWith(singer.member.id)
    const title = `Concert prep ${crypto.randomUUID().slice(0, 8)}`

    const created = await createEvent({
      client: admin.client,
      body: eventForm(title, { targets: [{ groupId: choirId }] })
    })
    expect(created.response?.status).toBe(201)
    const eventId = created.data?.id ?? ""

    const draftList = await listUpcomingEvents({ client: singer.client })
    expect(draftList.data?.items.some((item) => item.id === eventId)).toBe(false)
    expect(draftList.data?.permissions).toEqual({ create: false })
    expect((await getEventPage({ client: singer.client, path: { eventId } })).response?.status).toBe(404)

    const published = await changeEventStatus({
      client: admin.client,
      path: { eventId },
      body: { status: "Published" }
    })
    expect(published.data).toEqual({ id: eventId })

    const page = await getEventPage({ client: singer.client, path: { eventId } })
    expect(page.data).toMatchObject({ id: eventId, title, status: "Published", canManage: false })
    expect((await listUpcomingEvents({ client: singer.client })).data?.items.map((item) => item.id)).toContain(eventId)
    expect((await getEventPage({ client: outsider.client, path: { eventId } })).response?.status).toBe(404)

    await changeEventStatus({ client: admin.client, path: { eventId }, body: { status: "Cancelled" } })
    const cancelled = await listUpcomingEvents({ client: singer.client })
    expect(cancelled.data?.items.find((item) => item.id === eventId)?.status).toBe("Cancelled")
  })

  test("lets an Admin manage Events and refuses an ordinary member", async () => {
    const admin = await h.signedIn({ role: "admin" })
    const member = await h.signedIn()
    const eventId = (await createEvent({ client: admin.client, body: eventForm("Board meeting") })).data?.id ?? ""

    const managed = await listManagedEvents({ client: admin.client })
    expect(managed.data?.permissions).toEqual({ create: true, administer: true })
    expect(managed.data?.items.map((item) => item.id)).toContain(eventId)
    expect((await getEventEditor({ client: admin.client, path: { eventId } })).data).toMatchObject({
      id: eventId,
      status: "Draft",
      values: { title: "Board meeting", startsAt: expect.stringMatching(/T18:00$/) }
    })

    expect((await listManagedEvents({ client: member.client })).data).toEqual({
      items: [],
      permissions: { create: false, administer: false }
    })
    expect((await getEventEditor({ client: member.client, path: { eventId } })).response?.status).toBe(404)
    expect((await createEvent({ client: member.client, body: eventForm("Mine") })).response?.status).toBe(403)
    expect((await deleteEvent({ client: member.client, path: { eventId } })).response?.status).toBe(403)

    expect((await deleteEvent({ client: admin.client, path: { eventId } })).data).toEqual({ id: eventId })
    expect((await getEventEditor({ client: admin.client, path: { eventId } })).response?.status).toBe(404)
  })

  test("reports the Event rule a form breaks", async () => {
    const admin = await h.signedIn({ role: "admin" })
    const year = new Date().getFullYear() + 1

    const backwards = await createEvent({
      client: admin.client,
      body: eventForm("Backwards", {
        schedule: { allDay: false, startsAt: `${year}-03-01T20:00`, endsAt: `${year}-03-01T18:00` }
      })
    })
    const untitled = await createEvent({ client: admin.client, body: eventForm("  ") })
    const malformed = await createEvent({ client: admin.client, body: eventForm("Bad", { type: "Picnic" }) })

    expect(backwards.response?.status).toBe(400)
    expect(backwards.error).toEqual({ code: "ENDS_BEFORE_START" })
    expect(untitled.error).toEqual({ code: "TITLE_REQUIRED" })
    expect(malformed.error).toEqual({ code: "INVALID_INPUT" })
  })

  test("stops a demoted Admin managing Events on the next request", async () => {
    const admin = await h.signedIn({ role: "admin" })
    const eventId = (await createEvent({ client: admin.client, body: eventForm("Demotion") })).data?.id ?? ""

    await h.setAccount(admin.member.id, { role: "user" })

    const refused = await changeEventStatus({ client: admin.client, path: { eventId }, body: { status: "Published" } })
    expect(refused.response?.status).toBe(403)
  })

  test("keeps Locations to Admins and refuses duplicate names", async () => {
    const admin = await h.signedIn({ role: "admin" })
    const member = await h.signedIn()
    const name = `Hall ${crypto.randomUUID().slice(0, 8)}`

    const created = await createLocation({ client: admin.client, body: { name, address: "Gibraltargatan 1" } })
    const duplicate = await createLocation({ client: admin.client, body: { name } })
    expect(created.response?.status).toBe(201)
    expect(duplicate.error).toEqual({ code: "LOCATION_NAME_TAKEN" })

    const locationId = created.data?.id ?? ""
    expect((await listLocations({ client: admin.client })).data?.items).toContainEqual({
      id: locationId,
      name,
      address: "Gibraltargatan 1",
      mapUrl: null,
      active: true,
      eventCount: 0
    })
    expect((await archiveLocation({ client: admin.client, path: { locationId } })).data).toEqual({ id: locationId })
    expect((await listLocations({ client: member.client })).response?.status).toBe(403)
    expect((await createLocation({ client: member.client, body: { name: "Mine" } })).response?.status).toBe(403)
  })
})

import { afterAll, describe, expect, test } from "bun:test"
import {
  addGroupMembers,
  getConversation,
  getConversationUnread,
  leaveGroupConversation,
  listConversations,
  markConversationRead,
  renameGroupConversation,
  searchMessageRecipients,
  sendMessage,
  startConversation
} from "@csk-hub/contract/client"
import { createApiHarness } from "../../test/api"
import { createTestDatabase } from "../../test/database"

const database = await createTestDatabase()

describe.skipIf(!database)("Conversations and Messages over HTTP", () => {
  const t = database as NonNullable<typeof database>
  afterAll(() => t.drop())
  const h = createApiHarness(t)

  async function direct(text = "Hej!") {
    const sender = await h.signedIn({ name: "Sender Siv" })
    const recipient = await h.signedIn({ name: "Recipient Rut" })
    const started = await startConversation({
      client: sender.client,
      body: { memberIds: [recipient.member.id], text, idempotencyKey: crypto.randomUUID() }
    })
    return { sender, recipient, conversationId: started.data?.conversationId ?? "" }
  }

  test("starts a Direct Conversation the recipient reads as unread until they mark it read", async () => {
    const { sender, recipient, conversationId } = await direct("Rehearsal at seven")

    const inbox = await listConversations({ client: recipient.client })
    expect(inbox.data?.items).toEqual([
      {
        kind: "direct",
        id: conversationId,
        otherMemberName: "Sender Siv",
        preview: "Rehearsal at seven",
        sentAt: expect.any(String),
        unreadCount: 1,
        canSend: true
      }
    ])
    expect((await getConversationUnread({ client: recipient.client })).data).toEqual({ count: 1 })

    const page = await getConversation({ client: recipient.client, path: { conversationId } })
    expect(page.data).toMatchObject({
      kind: "direct",
      otherMemberName: "Sender Siv",
      otherMemberProfileId: sender.member.id,
      canSend: true,
      newestSequence: 1,
      messages: [{ sequence: 1, text: "Rehearsal at seven", isOwnMessage: false }]
    })

    const read = await markConversationRead({
      client: recipient.client,
      path: { conversationId },
      body: { sequence: 1, token: page.data?.readToken ?? "" }
    })
    expect(read.data).toEqual({ changed: true })
    expect((await getConversationUnread({ client: recipient.client })).data).toEqual({ count: 0 })

    const forged = await markConversationRead({
      client: sender.client,
      path: { conversationId },
      body: { sequence: 1, token: page.data?.readToken ?? "" }
    })
    expect(forged.response?.status).toBe(400)
    expect(forged.error).toEqual({ code: "READ_POSITION_INVALID" })
  })

  test("a retried Message with the same key is stored once and scheduled once", async () => {
    const { sender, recipient, conversationId } = await direct()
    const idempotencyKey = crypto.randomUUID()
    const scheduled = h.delivery.scheduled

    const first = await sendMessage({
      client: sender.client,
      path: { conversationId },
      body: { text: "Once", idempotencyKey }
    })
    const retry = await sendMessage({
      client: sender.client,
      path: { conversationId },
      body: { text: "Once", idempotencyKey }
    })
    const reused = await sendMessage({
      client: sender.client,
      path: { conversationId },
      body: { text: "Different", idempotencyKey }
    })

    expect(first.data).toMatchObject({ conversationId, sequence: 2, created: true })
    expect(retry.data).toEqual({ ...first.data, created: false } as typeof retry.data)
    expect(h.delivery.scheduled).toBe(scheduled + 1)
    expect(reused.response?.status).toBe(409)
    expect(reused.error).toEqual({ code: "IDEMPOTENCY_KEY_REUSED" })
    const page = await getConversation({ client: recipient.client, path: { conversationId } })
    expect(page.data?.messages.map((item) => item.text)).toEqual(["Hej!", "Once"])
  })

  test("hides a Conversation from everyone outside it", async () => {
    const { conversationId } = await direct()
    const outsider = await h.signedIn()

    const foreign = await getConversation({ client: outsider.client, path: { conversationId } })
    const sent = await sendMessage({
      client: outsider.client,
      path: { conversationId },
      body: { text: "Intrusion", idempotencyKey: crypto.randomUUID() }
    })
    const unknown = await getConversation({ client: outsider.client, path: { conversationId: crypto.randomUUID() } })
    const malformed = await getConversation({ client: outsider.client, path: { conversationId: "nope" } })

    expect(foreign.response?.status).toBe(403)
    expect(foreign.error).toEqual({ code: "CONVERSATION_VIEW_FORBIDDEN" })
    expect(sent.response?.status).toBeGreaterThanOrEqual(403)
    expect(unknown.response?.status).toBe(404)
    expect(malformed.response?.status).toBe(404)
    expect((await listConversations({ client: h.client() })).response?.status).toBe(401)
  })

  test("keeps history up to departure readable but closed to a member who left a Group", async () => {
    const creator = await h.signedIn({ name: "Creator Cia" })
    const leaver = await h.signedIn({ name: "Leaver Leo" })
    const stayer = await h.signedIn({ name: "Stayer Sam" })
    const created = await startConversation({
      client: creator.client,
      body: {
        memberIds: [creator.member.id, leaver.member.id, stayer.member.id],
        name: "Basses",
        idempotencyKey: crypto.randomUUID()
      }
    })
    const conversationId = created.data?.conversationId ?? ""
    await sendMessage({
      client: creator.client,
      path: { conversationId },
      body: { text: "Before", idempotencyKey: crypto.randomUUID() }
    })

    expect((await leaveGroupConversation({ client: leaver.client, path: { conversationId } })).data).toEqual({
      conversationId
    })
    await sendMessage({
      client: stayer.client,
      path: { conversationId },
      body: { text: "After", idempotencyKey: crypto.randomUUID() }
    })

    const page = await getConversation({ client: leaver.client, path: { conversationId } })
    expect(page.data).toMatchObject({ kind: "group", otherMemberName: "Basses", canSend: false, members: [] })
    expect(page.data?.messages.map((item) => item.text)).toEqual(["Before"])
    const blocked = await sendMessage({
      client: leaver.client,
      path: { conversationId },
      body: { text: "Let me back", idempotencyKey: crypto.randomUUID() }
    })
    expect(blocked.response?.status).toBe(403)
    const inbox = await listConversations({ client: leaver.client })
    expect(inbox.data?.items.find((item) => item.id === conversationId)).toMatchObject({ canSend: false })
  })

  test("closes a Direct Conversation once the other member is deactivated, keeping its history", async () => {
    const { sender, recipient, conversationId } = await direct("Still here")
    await h.setAccount(recipient.member.id, { banned: true })

    const page = await getConversation({ client: sender.client, path: { conversationId } })
    const sent = await sendMessage({
      client: sender.client,
      path: { conversationId },
      body: { text: "Hello?", idempotencyKey: crypto.randomUUID() }
    })

    expect(page.data).toMatchObject({ canSend: false, otherMemberProfileId: null })
    expect(page.data?.messages.map((item) => item.text)).toEqual(["Still here"])
    expect(sent.response?.status).toBe(409)
    expect(sent.error).toEqual({ code: "CONVERSATION_RECIPIENT_INACTIVE" })
    expect((await listConversations({ client: recipient.client })).response?.status).toBe(401)
  })

  test("searches other active members and refuses messaging oneself", async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    const viewer = await h.signedIn({ name: `Viewer ${tag}` })
    const other = await h.createMember({ name: `Other ${tag}` })

    const found = await searchMessageRecipients({ client: viewer.client, query: { query: tag } })
    const self = await startConversation({
      client: viewer.client,
      body: { memberIds: [viewer.member.id], text: "Me", idempotencyKey: crypto.randomUUID() }
    })

    expect(found.data?.items).toEqual([{ id: other.id, name: `Other ${tag}`, username: null }])
    expect(self.response?.status).toBe(400)
    expect(self.error).toEqual({ code: "SELF_RECIPIENT" })
  })

  test("lets Group members rename and add members, and refuses outsiders and signed-out callers", async () => {
    const creator = await h.signedIn()
    const member = await h.createMember()
    const newcomer = await h.signedIn()
    const outsider = await h.signedIn()
    const created = await startConversation({
      client: creator.client,
      body: { memberIds: [creator.member.id, member.id], name: "Altos", idempotencyKey: crypto.randomUUID() }
    })
    const conversationId = created.data?.conversationId ?? ""

    const renamed = await renameGroupConversation({
      client: creator.client,
      path: { conversationId },
      body: { name: "Altos 2" }
    })
    const added = await addGroupMembers({
      client: creator.client,
      path: { conversationId },
      body: { memberIds: [newcomer.member.id] }
    })
    const refused = await renameGroupConversation({
      client: outsider.client,
      path: { conversationId },
      body: { name: "Mine" }
    })
    const anonymous = await sendMessage({
      client: h.client(),
      path: { conversationId },
      body: { text: "Hi", idempotencyKey: crypto.randomUUID() }
    })

    expect(renamed.data).toEqual({ conversationId })
    expect(added.data).toEqual({ conversationId })
    expect((await getConversation({ client: newcomer.client, path: { conversationId } })).data?.otherMemberName).toBe(
      "Altos 2"
    )
    expect(refused.response?.status).toBe(403)
    expect(anonymous.response?.status).toBe(401)
  })
})

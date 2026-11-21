import { describe, expect, mock, test } from "bun:test"

class MessagingAccessError extends Error {
  constructor(readonly kind: string) {
    super(kind)
  }
}

const requirePermission = mock(async () => ({ userId: "sender", isAdmin: false }))
const requireActiveDirectRecipient = mock()
const resolveActiveDirectCounterpart = mock()
const appendMessage = mock()
const db = { select: mock(), transaction: mock() }

mock.module("@/core/db", () => ({ db }))
mock.module("@csk-hub/shared/features/messaging/model/messaging-error", () => ({ MessagingAccessError }))
mock.module("./direct-recipient", () => ({ requireActiveDirectRecipient, resolveActiveDirectCounterpart }))
mock.module("./append-message", () => ({ appendMessage }))

const { sendMessage } = await import("./send-message")
// The mocked database and authority, passed explicitly as the HTTP API passes its own.
const messaging = {
  database: (await import("@/core/db")).db,
  authorize: requirePermission
} as unknown as import("@/features/messaging/model/context").MessagingContext

describe("sendMessage", () => {
  test("rejects a direct conversation whose counterpart is inactive", async () => {
    resolveActiveDirectCounterpart.mockRejectedValueOnce(new MessagingAccessError("conversation-recipient-inactive"))
    const tx = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ kind: "direct" }] }) }) }) }
    db.transaction.mockImplementationOnce((callback: (transaction: typeof tx) => unknown) => callback(tx))

    await expect(
      sendMessage({ conversationId: "conversation-1", text: "Hello", idempotencyKey: "request-1" }, messaging)
    ).rejects.toMatchObject({ kind: "conversation-recipient-inactive" })

    expect(requirePermission).toHaveBeenCalledTimes(1)
    expect(requirePermission).toHaveBeenCalledWith({ action: "app.access" }, tx)
    expect(appendMessage).not.toHaveBeenCalled()
  })
})

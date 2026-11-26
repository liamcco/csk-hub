import { createHash } from "node:crypto"
import { groupMemberIds, normalizeGroupName } from "@csk-hub/shared/features/messaging/model/group-conversation"
import { MessagingAccessError } from "@csk-hub/shared/features/messaging/model/messaging-error"
import { and, eq, inArray } from "drizzle-orm"
import { user } from "@/core/db/schema/auth"
import { conversation, conversationReadState, groupConversation, groupMembership } from "@/core/db/schema/messaging"
import { lockKey } from "@/core/db/sql"
import { queueConversationActivity } from "../activity"
import type { MessagingContext } from "../model/context"
import type { MessageTransaction } from "../sending"
import { lockGroupConversation, requireActiveGroupMember } from "./access"

async function requireActiveUsers(tx: MessageTransaction, ids: string[]) {
  // Stable order avoids deadlocks when concurrent additions overlap.
  const members = await tx
    .select({ id: user.id, banned: user.banned })
    .from(user)
    .where(inArray(user.id, ids))
    .orderBy(user.id)
    .for("share")
  const membersById = new Map(members.map((member) => [member.id, member]))
  for (const id of ids) {
    const member = membersById.get(id)
    if (!member) throw new MessagingAccessError("recipient-required")
    if (member.banned) throw new MessagingAccessError("recipient-inactive")
  }
}

export async function createGroupConversation(
  input: { name: unknown; memberIds: string[]; idempotencyKey: string },
  context: MessagingContext
) {
  const { database, authorize } = context
  const name = normalizeGroupName(input.name)
  if (!input.idempotencyKey.trim()) throw new MessagingAccessError("idempotency-key-required")
  return database.transaction(async (tx) => {
    const { userId } = await authorize({ action: "app.access" }, tx)
    const ids = groupMemberIds(input.memberIds, userId)
    const payloadHash = createHash("sha256")
      .update(JSON.stringify([name, ids]))
      .digest("hex")
    // Serialize retries for this creator/key before checking whether the original intent committed.
    await lockKey(tx, JSON.stringify(["group-creation", userId, input.idempotencyKey]))
    const [existing] = await tx
      .select({ conversationId: groupConversation.conversationId, payloadHash: groupConversation.creationPayloadHash })
      .from(groupConversation)
      .where(
        and(
          eq(groupConversation.createdByUserId, userId),
          eq(groupConversation.creationIdempotencyKey, input.idempotencyKey)
        )
      )
      .limit(1)
    if (existing) {
      if (existing.payloadHash !== payloadHash) throw new MessagingAccessError("idempotency-key-reused")
      return { conversationId: existing.conversationId }
    }
    await requireActiveUsers(tx, ids)
    const [created] = await tx.insert(conversation).values({ kind: "group" }).returning({ id: conversation.id })
    if (!created) throw new Error("Group Conversation creation did not return a record.")
    const conversationId = created.id
    await tx.insert(groupConversation).values({
      conversationId,
      name,
      createdByUserId: userId,
      creationIdempotencyKey: input.idempotencyKey,
      creationPayloadHash: payloadHash
    })
    await tx.insert(groupMembership).values(ids.map((userId) => ({ conversationId, userId })))
    await tx.insert(conversationReadState).values(ids.map((userId) => ({ conversationId, userId })))
    await queueConversationActivity(tx, conversationId)
    return { conversationId }
  })
}

export async function addGroupMembers(
  input: { conversationId: string; memberIds: string[] },
  context: MessagingContext
) {
  const { database, authorize } = context
  const ids = groupMemberIds(input.memberIds)
  return database.transaction(async (tx) => {
    const { userId } = await authorize({ action: "app.access" }, tx)
    const row = await lockGroupConversation(tx, input.conversationId)
    await requireActiveGroupMember(tx, input.conversationId, userId, "group-management-forbidden")
    await requireActiveUsers(tx, ids)
    // With the Conversation locked, the memberships read here are the ones the writes below change.
    const memberships = await tx
      .select({ userId: groupMembership.userId, leftAt: groupMembership.leftAt })
      .from(groupMembership)
      .where(and(eq(groupMembership.conversationId, input.conversationId), inArray(groupMembership.userId, ids)))
    const departed = new Set(memberships.filter(({ leftAt }) => leftAt !== null).map(({ userId }) => userId))
    const current = new Set(memberships.map(({ userId }) => userId))
    const joining = ids.filter((userId) => !current.has(userId))
    if (joining.length)
      await tx
        .insert(groupMembership)
        .values(joining.map((userId) => ({ conversationId: input.conversationId, userId })))
    if (departed.size)
      await tx
        .update(groupMembership)
        .set({ joinedAt: new Date(), leftAt: null, historyVisibleThroughSequence: null })
        .where(
          and(eq(groupMembership.conversationId, input.conversationId), inArray(groupMembership.userId, [...departed]))
        )
    // Only new or rejoined memberships count; active members keep their unread position.
    const added = [...joining, ...departed].map((userId) => ({ userId }))
    if (added.length)
      await tx
        .insert(conversationReadState)
        .values(
          added.map(({ userId }) => ({
            conversationId: input.conversationId,
            userId,
            lastReadSequence: row.nextMessageSequence - 1
          }))
        )
        .onConflictDoUpdate({
          target: [conversationReadState.conversationId, conversationReadState.userId],
          set: { lastReadSequence: row.nextMessageSequence - 1 }
        })
    await queueConversationActivity(tx, input.conversationId)
    return { conversationId: input.conversationId }
  })
}

export async function renameGroupConversation(
  input: { conversationId: string; name: unknown },
  context: MessagingContext
) {
  const { database, authorize } = context
  const name = normalizeGroupName(input.name)
  return database.transaction(async (tx) => {
    const { userId } = await authorize({ action: "app.access" }, tx)
    await lockGroupConversation(tx, input.conversationId)
    await requireActiveGroupMember(tx, input.conversationId, userId, "group-management-forbidden")
    await tx
      .update(groupConversation)
      .set({ name, updatedAt: new Date() })
      .where(eq(groupConversation.conversationId, input.conversationId))
    await queueConversationActivity(tx, input.conversationId)
    return { conversationId: input.conversationId }
  })
}

export async function leaveGroupConversation(conversationId: string, context: MessagingContext) {
  const { database, authorize } = context
  return database.transaction(async (tx) => {
    const { userId } = await authorize({ action: "app.access" }, tx)
    const row = await lockGroupConversation(tx, conversationId)
    await requireActiveGroupMember(tx, conversationId, userId, "group-management-forbidden")
    await tx
      .update(groupMembership)
      .set({ leftAt: new Date(), historyVisibleThroughSequence: row.nextMessageSequence - 1 })
      .where(and(eq(groupMembership.conversationId, conversationId), eq(groupMembership.userId, userId)))
    await queueConversationActivity(tx, conversationId, userId)
    return { conversationId }
  })
}

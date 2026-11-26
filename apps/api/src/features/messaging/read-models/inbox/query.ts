import { and, count, desc, eq, exists, or, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { user } from "@/core/db/schema/auth"
import {
  conversationReadState,
  directConversation,
  groupConversation,
  groupMembership,
  message
} from "@/core/db/schema/messaging"
import { groupHistoryVisibility } from "../../group-conversations/access"
import type { MessagingContext } from "../../model/context"
import { toInboxConversations } from "./view-model"

// The latest Message and the unread count are correlated subqueries rather than lateral joins,
// which MariaDB lacks; both databases plan them per conversation all the same.

export async function listDirectConversations(context: MessagingContext) {
  const { database, authorize } = context
  const { userId } = await authorize({ action: "app.access" })
  const otherMember = alias(user, "other_member")

  const inConversation = eq(message.conversationId, conversationReadState.conversationId)
  const latest = (field: typeof message.text | typeof message.sentAt) =>
    database.select({ field }).from(message).where(inConversation).orderBy(desc(message.sequence)).limit(1)
  const unread = database
    .select({ count: count() })
    .from(message)
    .where(and(inConversation, sql`${message.sequence} > ${conversationReadState.lastReadSequence}`))
  const latestSentAt = sql<Date>`(${latest(message.sentAt)})`.mapWith(message.sentAt)

  const rows = await database
    .select({
      conversationId: conversationReadState.conversationId,
      otherMemberId: otherMember.id,
      otherMemberName: otherMember.name,
      otherMemberBanned: otherMember.banned,
      latestMessageText: sql<string>`(${latest(message.text)})`,
      latestMessageSentAt: latestSentAt,
      unreadCount: sql<number>`(${unread})`.mapWith(Number)
    })
    .from(conversationReadState)
    .innerJoin(directConversation, eq(directConversation.conversationId, conversationReadState.conversationId))
    .leftJoin(
      otherMember,
      or(
        and(eq(directConversation.firstMemberId, userId), eq(otherMember.id, directConversation.secondMemberId)),
        and(eq(directConversation.secondMemberId, userId), eq(otherMember.id, directConversation.firstMemberId))
      )
    )
    // A direct Conversation shows once it has a Message.
    .where(
      and(
        eq(conversationReadState.userId, userId),
        exists(database.select({ id: message.id }).from(message).where(inConversation))
      )
    )
    .orderBy(desc(latestSentAt))

  return toInboxConversations(rows)
}

export async function listConversations(context: MessagingContext) {
  const resolved = context
  const [direct, groups] = await Promise.all([listDirectConversations(resolved), listGroupConversations(resolved)])
  return [...direct, ...groups].sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
}

async function listGroupConversations(context: MessagingContext) {
  const { database, authorize } = context
  const { userId } = await authorize({ action: "app.access" })
  const visibleMessage = and(
    eq(message.conversationId, groupMembership.conversationId),
    groupHistoryVisibility(message.sequence, groupMembership.historyVisibleThroughSequence)
  )
  const latest = (field: typeof message.text | typeof message.sentAt) =>
    database.select({ field }).from(message).where(visibleMessage).orderBy(desc(message.sequence)).limit(1)
  const unread = database
    .select({ count: count() })
    .from(message)
    .where(and(visibleMessage, sql`${message.sequence} > COALESCE(${conversationReadState.lastReadSequence}, 0)`))
  const rows = await database
    .select({
      id: groupMembership.conversationId,
      otherMemberName: groupConversation.name,
      preview: sql<string | null>`(${latest(message.text)})`,
      sentAt: sql<Date>`COALESCE((${latest(message.sentAt)}), ${groupConversation.createdAt})`.mapWith(
        groupConversation.createdAt
      ),
      unreadCount: sql<number>`(${unread})`.mapWith(Number),
      leftAt: groupMembership.leftAt
    })
    .from(groupMembership)
    .innerJoin(groupConversation, eq(groupConversation.conversationId, groupMembership.conversationId))
    .leftJoin(
      conversationReadState,
      and(
        eq(conversationReadState.conversationId, groupMembership.conversationId),
        eq(conversationReadState.userId, userId)
      )
    )
    .where(eq(groupMembership.userId, userId))
  return rows.map((row) => ({
    ...row,
    kind: "group" as const,
    sentAt: new Date(row.sentAt),
    unreadCount: Number(row.unreadCount),
    canSend: row.leftAt === null
  }))
}

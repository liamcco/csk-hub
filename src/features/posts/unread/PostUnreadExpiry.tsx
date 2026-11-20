import { useQuery } from "@tanstack/react-query"
import { postUnreadQuery } from "../query"
import { PostBadgeExpiry } from "./PostBadgeExpiry"

/** Refreshes unread counts when a Post enters or leaves the unread horizon. */
export function PostUnreadExpiry() {
  const nextChangeAt = useQuery(postUnreadQuery).data?.nextChangeAt ?? null
  return <PostBadgeExpiry at={nextChangeAt === null ? null : Date.parse(nextChangeAt)} />
}

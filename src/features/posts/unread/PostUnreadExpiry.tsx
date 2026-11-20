import { readPostUnread } from "../query"
import { PostBadgeExpiry } from "./PostBadgeExpiry"

/** Refreshes unread counts when a Post enters or leaves the unread horizon. */
export async function PostUnreadExpiry() {
  const { nextChangeAt } = await readPostUnread()
  return <PostBadgeExpiry at={nextChangeAt === null ? null : Date.parse(nextChangeAt)} />
}

/** The caller's unread Post count, for the navigation badge. */
export async function countUnreadPostsForBadge() {
  return (await readPostUnread()).count
}

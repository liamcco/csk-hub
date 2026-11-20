"use client"

import { markPostRead } from "@contract/client"
import { useEffect } from "react"
import { browserApiClient } from "@/core/api-client/browser"
import { useAppRouter } from "@/core/navigation/router"

/**
 * Marks the Post read once it is on screen. An effect rather than a write during render,
 * so prefetching a Post does not mark it read before the User has opened it.
 */
export function PostReadMarker({ postId }: { postId: string }) {
  const router = useAppRouter()
  useEffect(() => {
    // The navigation lives in the layout, which a client navigation to the Post keeps; only a
    // refresh re-renders its badge and the feed's unread marks. Failures leave the badge until
    // the next visit.
    markPostRead({ client: browserApiClient, path: { postId } })
      .then(({ data }) => {
        if (data?.changed) router.refresh()
      })
      .catch(() => {})
  }, [postId, router])
  return null
}

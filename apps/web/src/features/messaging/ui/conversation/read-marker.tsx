import { markConversationRead } from "@csk-hub/contract/client"
import { useEffect } from "react"
import { browserApiClient } from "@/core/api-client/browser"
import { useAppRouter } from "@/core/navigation/router"

export function ReadMarker({
  conversationId,
  sequence,
  token
}: {
  conversationId: string
  sequence: number
  token?: string
}) {
  const router = useAppRouter()
  useEffect(() => {
    const mark = () => {
      if (!token || document.visibilityState !== "visible") return
      markConversationRead({ client: browserApiClient, path: { conversationId }, body: { sequence, token } })
        .then(({ data }) => {
          // The navigation's unread badge lives in the layout, which only a refresh re-renders.
          if (data?.changed) router.refresh()
        })
        .catch(() => {})
    }
    mark()
    document.addEventListener("visibilitychange", mark)
    return () => document.removeEventListener("visibilitychange", mark)
  }, [conversationId, sequence, token, router])
  return null
}

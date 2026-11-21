import { type QueryKey, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import { useTranslations } from "@/core/i18n/translations"
import { parseSafeInternalPath } from "@/core/navigation/navigation-utils"
import { refreshReads, useAppRouter, usePathname, useSearchParams } from "@/core/navigation/router"
import {
  type ActivityChange,
  type ActivityEvent,
  activityEventSchema,
  activityReadySchema
} from "@/core/realtime/events"
import { toast } from "@/shared/ui/base/toast"
import { canPresentActivity } from "./presentation"

/** The cached reads an activity change affects, composed by the app from its features. */
export type AffectedReads = (change: ActivityChange) => QueryKey[]

/**
 * One SSE connection for this session. Each change invalidates the cached reads it affects, so
 * pages on screen refetch and others refresh when next shown. Hidden clients never acknowledge
 * notifications.
 */
export function ActivityConnection({ userId, affectedReads }: { userId: string; affectedReads: AffectedReads }) {
  const router = useAppRouter()
  const queryClient = useQueryClient()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const t = useTranslations("Realtime")
  const translate = useRef(t)
  translate.current = t
  const route = useRef({ pathname, older: searchParams.has("before") })
  route.current = { pathname, older: searchParams.has("before") }
  const affected = useRef(affectedReads)
  affected.current = affectedReads

  useEffect(() => {
    let disposed = false
    const deferred = new Map<string, ActivityEvent>()
    const seen = new Set<string>()
    const source = new EventSource("/api/realtime/events")

    const invalidate = (change: ActivityChange) => {
      for (const queryKey of affected.current(change)) void queryClient.invalidateQueries({ queryKey })
    }

    const present = async (event: ActivityEvent) => {
      if (!canPresentActivity(event, Date.now()) || document.visibilityState !== "visible" || disposed) return
      const href = parseSafeInternalPath(event.href)
      // The signed read marker acknowledges only after the refreshed timeline renders.
      if (event.kind === "message.created" && href === route.current.pathname && !route.current.older) return
      const key = `csk-activity:${userId}:${event.id}`
      const show = async () => {
        if (disposed || document.visibilityState !== "visible" || !canPresentActivity(event, Date.now())) return
        let alreadyShown = false
        try {
          alreadyShown = localStorage.getItem(key) !== null
        } catch {
          /* Storage can be disabled. */
        }
        if (!alreadyShown) {
          toast.add({
            id: event.id,
            title: translate.current(event.kind === "message.created" ? "newMessage" : "notification"),
            description: event.body,
            ...(href ? { actionProps: { children: translate.current("open"), onClick: () => router.push(href) } } : {})
          })
          try {
            localStorage.setItem(key, String(Date.now()))
          } catch {
            /* Best-effort cross-tab deduplication. */
          }
        }
        await fetch("/api/realtime/ack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: event.id }),
          keepalive: true
        }).catch(() => undefined)
      }
      if (navigator.locks) await navigator.locks.request(key, show)
      else await show()
    }

    const receive = (message: MessageEvent<string>) => {
      try {
        const parsed = activityEventSchema.safeParse(JSON.parse(message.data))
        if (!parsed.success || seen.has(parsed.data.id)) return
        const event = parsed.data
        seen.add(event.id)
        if (seen.size > 2_000) seen.delete(seen.values().next().value ?? "")
        invalidate(event)
        if (document.visibilityState !== "visible") {
          if (event.notify && deferred.size < 100) deferred.set(event.id, event)
          return
        }
        void present(event)
      } catch {
        /* Malformed transport data does not mutate UI or acknowledge anything. */
      }
    }
    const resume = () => {
      if (document.visibilityState !== "visible") return
      for (const event of deferred.values()) void present(event)
      deferred.clear()
    }
    const unauthorized = () => {
      // The account changed status or the session ended: establish who is signed in again.
      source.close()
      void router.reauthenticate()
    }
    const ready = (message: MessageEvent<string>) => {
      try {
        const parsed = activityReadySchema.safeParse(JSON.parse(message.data))
        // The server could not replay what this client missed: every cached read may be stale.
        if (parsed.success && parsed.data.reset) void refreshReads(queryClient)
      } catch {
        /* Invalid handshakes do not trigger a route refresh. */
      }
    }
    source.addEventListener("activity", receive as EventListener)
    source.addEventListener("ready", ready as EventListener)
    source.addEventListener("unauthorized", unauthorized)
    window.addEventListener("online", resume)
    window.addEventListener("focus", resume)
    document.addEventListener("visibilitychange", resume)
    // Keep deduplication storage bounded to the delivery retention period.
    try {
      for (const key of Object.keys(localStorage)) {
        if (
          key.startsWith(`csk-activity:${userId}:`) &&
          Number(localStorage.getItem(key)) < Date.now() - 7 * 86_400_000
        )
          localStorage.removeItem(key)
      }
    } catch {
      /* Optional storage. */
    }
    return () => {
      disposed = true
      source.close()
      window.removeEventListener("online", resume)
      window.removeEventListener("focus", resume)
      document.removeEventListener("visibilitychange", resume)
    }
  }, [router, queryClient, userId])

  return null
}

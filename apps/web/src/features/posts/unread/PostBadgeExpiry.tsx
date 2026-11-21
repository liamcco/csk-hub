import { useEffect, useTransition } from "react"
import { useAppRouter } from "@/core/navigation/router"

/** A one-shot predicate expiry, rather than periodic badge polling. */
export function PostBadgeExpiry({ at }: { at: number | null }) {
  const router = useAppRouter()
  const [, startTransition] = useTransition()
  useEffect(() => {
    if (at === null) return
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      const remaining = at - Date.now() + 100
      if (remaining <= 0) startTransition(() => router.refresh())
      else timer = setTimeout(schedule, Math.min(remaining, 2_147_000_000))
    }
    schedule()
    return () => clearTimeout(timer)
  }, [at, router])
  return null
}

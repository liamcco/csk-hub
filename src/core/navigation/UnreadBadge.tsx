import { useTranslations } from "@/core/i18n/translations"
import { Badge } from "@/shared/ui/base/badge"

type UnreadBadgeProps = {
  /** The destination's unread count; without one the badge renders nothing. */
  count: number | undefined
  /** `secondary` for placing the badge on a primary-coloured control. */
  variant?: "default" | "secondary"
}

/**
 * The signed-in User's unread count at a destination, for placing inside a link to it.
 * Renders nothing when the destination has no count, when there is nothing unread, or while loading.
 */
export function UnreadBadge({ count, variant }: UnreadBadgeProps) {
  const t = useTranslations("Navigation")
  if (!count) return null

  return (
    <>
      <Badge variant={variant} aria-hidden>
        {count}
      </Badge>
      <span className="sr-only">{t("unreadCount", { count })}</span>
    </>
  )
}

/**
 * A dot for a control that hides the navigation links, such as the mobile menu button,
 * shown while anything at any destination is unread. Position the control `relative`.
 */
export function UnreadIndicator({ counts }: { counts: (number | undefined)[] }) {
  const t = useTranslations("Navigation")
  if (!counts.some((unread) => (unread ?? 0) > 0)) return null

  return (
    <>
      <span aria-hidden className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary ring-2 ring-background" />
      <span className="sr-only">{t("unreadIndicator")}</span>
    </>
  )
}

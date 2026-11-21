import { useSession } from "@/core/auth/session"
import { ActivityConnection, type AffectedReads } from "./ActivityConnection"

/**
 * Opens the signed-in User's shared realtime connection for live updates and notifications.
 * Impersonated sessions get no connection, as the stream refuses them.
 */
export function ActivitySubscription({ affectedReads }: { affectedReads: AffectedReads }) {
  const session = useSession()
  if (!session || session.session.impersonatedBy) return null
  return <ActivityConnection key={session.user.id} userId={session.user.id} affectedReads={affectedReads} />
}

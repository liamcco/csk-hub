import { getCurrentActor } from "@contract/client"
import { getServerApiClient } from "@/core/api-client/server"
import { env } from "@/core/config/env"
import { ActivityConnection } from "./ActivityConnection"

/**
 * Opens the signed-in User's shared realtime connection for live updates and notifications. The
 * actor comes from the API; impersonated sessions get no connection, as the stream refuses them.
 */
export async function ActivitySubscription() {
  if (!env.REDIS_URL) return null
  const { data: actor } = await getCurrentActor({ client: await getServerApiClient() })
  if (!actor || actor.impersonatedBy) return null
  return <ActivityConnection key={actor.userId} userId={actor.userId} />
}

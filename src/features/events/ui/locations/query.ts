import "server-only"

import { asc, count, desc, eq } from "drizzle-orm"
import { requirePermission } from "@/core/authz"
import { type Database, db } from "@/core/db"
import { event, location } from "@/core/db/schema/events"

export type LocationRow = Awaited<ReturnType<typeof listLocations>>[number]

/** Every Location, active ones first, with how many Events use each. */
export async function listLocations(database: Database = db, authorize = requirePermission) {
  await authorize({ action: "event.administer" })
  return database
    .select({
      id: location.id,
      name: location.name,
      address: location.address,
      mapUrl: location.mapUrl,
      active: location.active,
      eventCount: count(event.id)
    })
    .from(location)
    .leftJoin(event, eq(event.locationId, location.id))
    .groupBy(location.id)
    .orderBy(desc(location.active), asc(location.name))
}

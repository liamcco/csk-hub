import { bootstrapOrgStructure } from "@/features/org-structure/defaults"
import type { SeedDatabase } from "./data"
import { seedEvents } from "./events"
import { seedGroups } from "./groups"
import { seedPosts } from "./posts"
import { seedUsers } from "./users"

/**
 * Seeds the default org structure (when the database has none), people, placements, group history,
 * Posts and Events together; any fixture conflict rolls back this demo transaction.
 */
export async function seedDemo(database: SeedDatabase) {
  return database.transaction(async (tx) => ({
    org: await bootstrapOrgStructure(tx),
    users: await seedUsers(tx),
    groups: await seedGroups(tx),
    posts: await seedPosts(tx),
    events: await seedEvents(tx)
  }))
}

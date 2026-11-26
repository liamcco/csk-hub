import { json, mysqlTable } from "drizzle-orm/mysql-core"
import { user } from "./auth"
import { key } from "./columns"

/** `../postgres/user-preferences.ts` on MariaDB. */
export const userPreferences = mysqlTable("user_preferences", {
  userId: key("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  preferences: json("preferences").notNull()
})

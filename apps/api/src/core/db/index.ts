import { env } from "@/core/config/env"
import { createDb } from "./client"

export const db = createDb(env.DATABASE_URL)

/** The application database client or an existing transaction. */
export type Database = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

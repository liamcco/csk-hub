import { isMariaDb } from "../dialect"
import * as mariadb from "./mariadb/notifications"
import * as postgres from "./postgres/notifications"

// The tables of this process's dialect, typed as PostgreSQL's; see `./README.md`.
const schema = (isMariaDb ? mariadb : postgres) as unknown as typeof postgres

export const { pushSubscription } = schema

// The PostgreSQL enums, for their value lists; MariaDB inlines them in its columns.
export { pushSubscriptionStatus } from "./postgres/notifications"

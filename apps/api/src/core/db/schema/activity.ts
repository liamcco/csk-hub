import { isMariaDb } from "../dialect"
import * as mariadb from "./mariadb/activity"
import * as postgres from "./postgres/activity"

// The tables of this process's dialect, typed as PostgreSQL's; see `./README.md`.
const schema = (isMariaDb ? mariadb : postgres) as unknown as typeof postgres

export const { activityDelivery } = schema

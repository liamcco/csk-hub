import { isMariaDb } from "../dialect"
import * as mariadb from "./mariadb/user-preferences"
import * as postgres from "./postgres/user-preferences"

// The tables of this process's dialect, typed as PostgreSQL's; see `./README.md`.
const schema = (isMariaDb ? mariadb : postgres) as unknown as typeof postgres

export const { userPreferences } = schema

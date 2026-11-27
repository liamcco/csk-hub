import { isMariaDb } from "../dialect"
import * as mariadb from "./mariadb/auth"
import * as postgres from "./postgres/auth"

// The tables of this process's dialect, typed as PostgreSQL's; see `./README.md`.
const schema = (isMariaDb ? mariadb : postgres) as unknown as typeof postgres

export const { user, session, account, verification, twoFactor, passkey, authRelations } = schema

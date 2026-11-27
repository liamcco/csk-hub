import { isMariaDb } from "../dialect"
import * as mariadb from "./mariadb/org-structure"
import * as postgres from "./postgres/org-structure"

// The tables of this process's dialect, typed as PostgreSQL's; see `./README.md`.
const schema = (isMariaDb ? mariadb : postgres) as unknown as typeof postgres

export const { group, choir, section, groupMember, position, groupTypePosition, positionGroup, positionHolder } = schema

// The PostgreSQL enums, for their value lists; MariaDB inlines them in its columns.
export { groupType } from "./postgres/org-structure"

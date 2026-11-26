import { isMariaDb } from "../dialect"
import * as mariadb from "./mariadb/voice"
import * as postgres from "./postgres/voice"

// The tables of this process's dialect, typed as PostgreSQL's; see `./README.md`.
const schema = (isMariaDb ? mariadb : postgres) as unknown as typeof postgres

export const { voiceCapability } = schema

// The PostgreSQL enums, for their value lists; MariaDB inlines them in its columns.
export { voice, voiceDivision, voiceFamily } from "./postgres/voice"

import { isMariaDb } from "../dialect"
import * as mariadb from "./mariadb/posts"
import * as postgres from "./postgres/posts"

// The tables of this process's dialect, typed as PostgreSQL's; see `./README.md`.
const schema = (isMariaDb ? mariadb : postgres) as unknown as typeof postgres

export const { post, postRead } = schema

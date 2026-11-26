import { isMariaDb } from "../dialect"
import * as mariadb from "./mariadb/messaging"
import * as postgres from "./postgres/messaging"

// The tables of this process's dialect, typed as PostgreSQL's; see `./README.md`.
const schema = (isMariaDb ? mariadb : postgres) as unknown as typeof postgres

export const { conversation, directConversation, groupConversation, groupMembership, conversationReadState, message } =
  schema

// The PostgreSQL enums, for their value lists; MariaDB inlines them in its columns.
export { conversationKind } from "./postgres/messaging"

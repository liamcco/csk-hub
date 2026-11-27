import { isMariaDb } from "../dialect"
import * as mariadb from "./mariadb/events"
import * as postgres from "./postgres/events"

// The tables of this process's dialect, typed as PostgreSQL's; see `./README.md`.
const schema = (isMariaDb ? mariadb : postgres) as unknown as typeof postgres

export const {
  location,
  eventSeries,
  event,
  eventDetail,
  rehearsal,
  gig,
  socialEvent,
  eventTarget,
  absenceReason,
  eventResponse,
  eventRegistrationQuestion,
  eventRegistrationQuestionOption,
  eventRegistration,
  eventRegistrationAnswer,
  eventRegistrationAnswerChoice,
  eventAttendance
} = schema

// The PostgreSQL enums, for their value lists; MariaDB inlines them in its columns.
export {
  attendanceStatus,
  eventStatus,
  eventType,
  participationMode,
  registrationQuestionKind,
  registrationStatus,
  rsvpAnswer
} from "./postgres/events"

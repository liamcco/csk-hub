import type { EventType, RehearsalKind } from "@csk-hub/shared/features/events/model"
import { useTranslations } from "@/core/i18n/translations"

/** What kind of Event it is: a Rehearsal by its derived kind, any other Event by its type. */
export function EventKind({ type, rehearsalKind }: { type: EventType; rehearsalKind: RehearsalKind | null }) {
  const types = useTranslations("Events.types")
  const kinds = useTranslations("Events.calendar.rehearsalKinds")
  return rehearsalKind ? kinds(rehearsalKind) : types(type)
}

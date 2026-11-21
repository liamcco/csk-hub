import {
  beforeSequence,
  ConversationScreen,
  ConversationScreenSkeleton,
  MessagesScreen,
  MessagesScreenSkeleton
} from "@/features/messaging"
import { type Screen, useParam, useSearchLoose } from "../route-hooks"

export const inbox: Screen = { component: MessagesScreen, pending: MessagesScreenSkeleton }
export const conversation: Screen = {
  component: () => (
    <ConversationScreen conversationId={useParam("conversationId")} beforeSequence={beforeSequence(useSearchLoose())} />
  ),
  pending: ConversationScreenSkeleton
}

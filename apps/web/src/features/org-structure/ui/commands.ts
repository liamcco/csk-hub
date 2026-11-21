import {
  addGroupMember,
  archiveGroup,
  assignPositionHolder,
  changeSingerVoice,
  createGroup,
  createPosition,
  endGroupMembership,
  endPositionHolding,
  renameGroup,
  updatePosition
} from "@csk-hub/contract/client"
import type { GroupType } from "@csk-hub/shared/features/org-structure/model"
import { browserApiClient as client } from "@/core/api-client/browser"
import { errorCode } from "@/core/api-client/result"
import type { GroupCommandError, GroupCommandState } from "./command-state"

type Outcome = { data?: unknown; error?: unknown; response?: Response }
type VoiceDivision = "S1" | "S2" | "A1" | "A2" | "T1" | "T2" | "B1" | "B2"

/** A form value, with an empty string read as absent. */
function value(formData: FormData, name: string) {
  const raw = formData.get(name)
  return typeof raw === "string" && raw.trim() !== "" ? raw : undefined
}

const text = (formData: FormData, name: string) => value(formData, name) ?? ""
const all = (formData: FormData, name: string) =>
  formData.getAll(name).filter((item): item is string => typeof item === "string")

/** Maps the API's `GROUP_NAME_TAKEN` back to the `group-name-taken` the screens translate. */
function failure({ error, response }: Outcome): GroupCommandError {
  const code = errorCode(error)
  if (response?.status !== 400 || !code) return "unexpected"
  if (code === "VALIDATION_FAILED") return "invalid-input"
  return code.toLowerCase().replaceAll("_", "-") as GroupCommandError
}

/** An action for a groups command dialog: runs the command through the API and reports how it went. */
function command(send: (formData: FormData) => Promise<Outcome>) {
  return async (_state: GroupCommandState, formData: FormData): Promise<GroupCommandState> => {
    try {
      const outcome = await send(formData)
      return outcome.data
        ? { status: "success", completedAt: Date.now() }
        : { status: "error", error: failure(outcome) }
    } catch {
      return { status: "error", error: "unexpected" }
    }
  }
}

export const createGroupAction = command((form) =>
  createGroup({
    client,
    body: {
      name: text(form, "name"),
      type: text(form, "type") as Exclude<GroupType, "Choir" | "Section">,
      choirId: value(form, "choirId")
    }
  })
)

export const renameGroupAction = command((form) =>
  renameGroup({ client, path: { groupId: text(form, "groupId") }, body: { name: text(form, "name") } })
)

export const archiveGroupAction = command((form) => archiveGroup({ client, path: { groupId: text(form, "groupId") } }))

/** Adds a member; in a Section, places them as a singer with the chosen Voice. */
export const addMemberAction = command((form) =>
  addGroupMember({
    client,
    path: { groupId: text(form, "groupId") },
    body: {
      userId: text(form, "userId"),
      startDate: text(form, "startDate"),
      voice: value(form, "voice") as VoiceDivision | undefined
    }
  })
)

export const endMembershipAction = command((form) =>
  endGroupMembership({
    client,
    path: { groupId: text(form, "groupId"), userId: text(form, "userId") },
    body: { endDate: text(form, "endDate") }
  })
)

/** Changes a singer's Voice from their Section's page; the Voice may move them to another Section. */
export const changeVoiceAction = command((form) =>
  changeSingerVoice({
    client,
    path: { groupId: text(form, "groupId"), userId: text(form, "userId") },
    body: { voice: text(form, "voice") as VoiceDivision, date: text(form, "date") }
  })
)

/** Gives a Position to a member, ending any current holder's holding on the same day. */
export const assignHolderAction = command((form) =>
  assignPositionHolder({
    client,
    path: { groupId: text(form, "groupId"), positionId: text(form, "positionId") },
    body: { userId: text(form, "userId"), startDate: text(form, "startDate") }
  })
)

export const endHoldingAction = command((form) =>
  endPositionHolding({
    client,
    path: { groupId: text(form, "groupId"), positionId: text(form, "positionId") },
    body: { userId: text(form, "userId"), endDate: text(form, "endDate") }
  })
)

function positionInput(form: FormData) {
  return {
    name: text(form, "name"),
    groupTypes: all(form, "groupTypes") as GroupType[],
    groupIds: all(form, "groupIds")
  }
}

export const createPositionAction = command((form) => createPosition({ client, body: positionInput(form) }))

/** Renames a Position and replaces the GroupTypes it may be held in and its limit to groups, as one edit. */
export const updatePositionAction = command((form) =>
  updatePosition({ client, path: { positionId: text(form, "positionId") }, body: positionInput(form) })
)

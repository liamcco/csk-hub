import { SettingsIcon, XIcon } from "lucide-react"
import { useTranslations } from "@/core/i18n/translations"
import { Button } from "@/shared/ui/base/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/shared/ui/base/dialog"
import { GroupCommandForm } from "./group-command-form"
import { LeaveGroupDialog } from "./leave-group-dialog"

export function GroupControls({
  conversationId,
  name,
  members
}: {
  conversationId: string
  name: string
  members: { id: string; name: string }[]
}) {
  const t = useTranslations("Messages")
  const ui = useTranslations("Ui")
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={t("groupSettings")}
            title={t("groupSettings")}
          />
        }
      >
        <SettingsIcon aria-hidden="true" />
      </DialogTrigger>
      <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader className="pr-8">
          <DialogTitle>{t("groupSettings")}</DialogTitle>
          <DialogDescription>{t("groupSettingsDescription")}</DialogDescription>
        </DialogHeader>
        <DialogClose
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute right-4 top-4"
              aria-label={ui("close")}
            />
          }
        >
          <XIcon aria-hidden="true" />
        </DialogClose>
        <div className="grid gap-6">
          <section>
            <h2 className="mb-2 font-medium">{t("groupMembers", { count: members.length })}</h2>
            <ul className="mb-3 space-y-1 text-sm">
              {members.map((member) => (
                <li key={member.id} className="wrap-break-word">
                  {member.name}
                </li>
              ))}
            </ul>
            <GroupCommandForm operation="add" conversationId={conversationId} members={members} />
          </section>
          <GroupCommandForm operation="rename" conversationId={conversationId} name={name} />
          <LeaveGroupDialog conversationId={conversationId} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

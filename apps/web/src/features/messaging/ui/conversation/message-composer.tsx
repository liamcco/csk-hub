"use client"

import { conversationPath } from "@csk-hub/shared/core/navigation/navigation-utils"
import { MAX_MESSAGE_BODY_LENGTH } from "@csk-hub/shared/features/messaging/model/message-body"
import { ArrowUpIcon } from "lucide-react"
import { useActionState, useEffect, useState } from "react"
import { useTranslations } from "@/core/i18n/translations"
import { useAppRouter } from "@/core/navigation/router"
import { Button } from "@/shared/ui/base/button"
import { useMessageScroller } from "@/shared/ui/base/message-scroller"
import { Textarea } from "@/shared/ui/base/textarea"
import { sendMessageCommand } from "../api-commands"
import { createMessageIdempotencyKey, nextMessageIdempotencyKey } from "../composer/idempotency-key"
import type { MessageCommandState } from "../composer/message-command-state"
import { submitOnEnter } from "../composer/submit-on-enter"

const initialState: MessageCommandState = { status: "idle" }

export function MessageComposer({ conversationId, readOnly }: { conversationId: string; readOnly: boolean }) {
  const t = useTranslations("Messages")
  const router = useAppRouter()
  const { scrollToEnd } = useMessageScroller()

  const [idempotencyKey, setIdempotencyKey] = useState(createMessageIdempotencyKey)
  const [state, action, pending] = useActionState(sendMessageCommand, initialState)

  useEffect(() => {
    if (state.status !== "success") return
    setIdempotencyKey((currentKey) => nextMessageIdempotencyKey(currentKey))
    router.replace(conversationPath(state.conversationId), { scroll: false })
    router.refresh()
    scrollToEnd({ behavior: "smooth" })
  }, [router, scrollToEnd, state])

  useEffect(() => {
    if (state.status !== "error" || state.error !== "idempotency-key-reused") return
    setIdempotencyKey((currentKey) => nextMessageIdempotencyKey(currentKey))
  }, [state])

  if (readOnly) return <p className="text-sm text-muted-foreground">{t("readOnly")}</p>

  return (
    <form action={action} className="grid gap-3">
      <input name="conversationId" type="hidden" value={conversationId} />
      <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
      <div className="relative">
        <Textarea
          name="text"
          className="pr-14"
          aria-label={t("messageLabel")}
          placeholder={t("messagePlaceholder")}
          required
          maxLength={MAX_MESSAGE_BODY_LENGTH}
          defaultValue={state.status === "error" ? state.text : undefined}
          onKeyDown={(event) => submitOnEnter(event, pending)}
        />
        <Button
          type="submit"
          size="icon-sm"
          className="absolute right-3 bottom-3 rounded-full"
          disabled={pending}
          aria-label={pending ? t("sending") : t("sendMessage")}
          title={pending ? t("sending") : t("sendMessage")}
        >
          <ArrowUpIcon aria-hidden="true" />
        </Button>
      </div>
      {state.status === "error" ? (
        <p className="text-sm text-destructive" role="alert">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
    </form>
  )
}

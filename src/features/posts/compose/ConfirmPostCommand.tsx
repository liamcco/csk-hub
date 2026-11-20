"use client"

import { useState, useTransition } from "react"
import { useTranslations } from "@/core/i18n/translations"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/shared/ui/base/alert-dialog"
import { Button } from "@/shared/ui/base/button"
import { type PostCommand, type PostCommandError, runPostCommand } from "./submit"
import { useAppRouter } from "@/core/navigation/router"

const COPY = {
  unpublish: {
    label: "unpublish",
    pending: "unpublishing",
    title: "unpublishTitle",
    description: "unpublishDescription"
  },
  discard: { label: "discardDraft", pending: "discarding", title: "discardTitle", description: "discardDescription" }
} as const

/**
 * A button that asks before changing a Post's state for good — recalling a published Post,
 * throwing a draft away. The action sends the Admin to the feed once it is done.
 */
export function ConfirmPostCommand({ command, postId }: { command: PostCommand; postId: string }) {
  const t = useTranslations("Posts")
  const common = useTranslations("Common")
  const router = useAppRouter()
  const copy = COPY[command]
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<PostCommandError | null>(null)
  const [pending, startTransition] = useTransition()

  function confirm() {
    startTransition(async () => {
      const outcome = await runPostCommand(command, postId)
      if ("error" in outcome) {
        setError(outcome.error)
        return
      }
      // The Post page stops existing, so leave it before anything re-renders it.
      router.push(outcome.destination)
    })
  }

  return (
    <>
      <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <AlertDialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
          {t(copy.label)}
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(copy.title)}</AlertDialogTitle>
            <AlertDialogDescription>{t(copy.description)}</AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {t(error)}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{common("cancel")}</AlertDialogCancel>
            <AlertDialogAction type="button" onClick={confirm} variant="destructive" disabled={pending}>
              {pending ? t(copy.pending) : t(copy.label)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

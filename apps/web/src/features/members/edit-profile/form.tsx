import { updateProfileVoices } from "@csk-hub/contract/client"
import { ROUTES } from "@csk-hub/shared/core/navigation/site"
import type { EditProfileState } from "@csk-hub/shared/features/members/edit-profile/state"
import { VOICE_DIVISIONS, type VoiceDivision } from "@csk-hub/shared/features/voice/model"
import { type FormEvent, useState, useTransition } from "react"
import { browserApiClient } from "@/core/api-client/browser"
import { useTranslations } from "@/core/i18n/translations"
import { Link, useAppRouter } from "@/core/navigation/router"
import { Button, buttonVariants } from "@/shared/ui/base/button"
import { Card, CardContent } from "@/shared/ui/base/card"
import { Checkbox } from "@/shared/ui/base/checkbox"

async function saveVoices(voices: VoiceDivision[]): Promise<EditProfileState> {
  try {
    const { data, response } = await updateProfileVoices({ client: browserApiClient, body: { voices } })
    if (data) return { status: "success", voices: data.voices }
    if (response?.status === 401) return { status: "error", error: "sign-in-required" }
    if (response?.status === 400) return { status: "error", error: "invalid-voices" }
    return { status: "error", error: "unexpected" }
  } catch {
    return { status: "error", error: "unexpected" }
  }
}

export function EditProfileForm({ initialVoices }: { initialVoices: VoiceDivision[] }) {
  const t = useTranslations("MemberProfiles")
  const router = useAppRouter()
  const [voices, setVoices] = useState(initialVoices)
  const [state, setState] = useState<EditProfileState>({ status: "idle" })
  const [pending, startTransition] = useTransition()
  const savedVoices = state.status === "success" ? state.voices : initialVoices
  const changed = voices.length !== savedVoices.length || voices.some((voice) => !savedVoices.includes(voice))

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startTransition(async () => {
      const result = await saveVoices(voices)
      setState(result)
      if (result.status === "success") router.refresh()
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Card>
        <CardContent>
          <fieldset disabled={pending} aria-describedby="voice-capabilities-description">
            <legend className="mb-2 font-heading text-lg font-semibold">{t("canSing")}</legend>
            <p id="voice-capabilities-description" className="mb-5 text-sm text-muted-foreground">
              {t("capabilitiesDescription")}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {VOICE_DIVISIONS.map((voice) => (
                <label
                  key={voice}
                  htmlFor={`voice-${voice}`}
                  className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 has-data-checked:border-primary has-data-checked:bg-primary/5"
                >
                  <Checkbox
                    id={`voice-${voice}`}
                    name="voices"
                    value={voice}
                    checked={voices.includes(voice)}
                    disabled={pending}
                    onCheckedChange={(checked) =>
                      setVoices((current) =>
                        checked ? [...current, voice] : current.filter((value) => value !== voice)
                      )
                    }
                  />
                  <span className="font-medium">{voice}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </CardContent>
      </Card>
      {state.status === "error" ? (
        <p className="text-sm text-destructive" role="alert">
          {t(`editErrors.${state.error}`)}
        </p>
      ) : null}
      {state.status === "success" && !changed ? (
        <p className="text-sm" role="status">
          {t("profileSaved")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending || !changed}>
          {t(pending ? "savingProfile" : "saveProfile")}
        </Button>
        <Link href={ROUTES.account} className={buttonVariants({ variant: "outline" })}>
          {t("backToProfile")}
        </Link>
      </div>
    </form>
  )
}

import { queryOptions, useSuspenseQuery } from "@tanstack/react-query"
import { capabilitiesQuery } from "@/core/api-client/capabilities"
import { authClient } from "@/core/auth/auth-client"
import { AccountSettingsTabs } from "./account-settings-tabs"
import { PushNotificationSettings } from "./notifications"
import { LanguageSettings, ProfileSettings } from "./profile"
import { PasskeySettings, PasswordSettings, SessionsSettings, TwoFactorSettings } from "./security"

/**
 * Better Auth's own session, read past its cookie cache, for the profile, two-factor and session
 * details the settings show. `/api/auth` keeps serving it outside `/api/v1`.
 */
export const accountSessionQuery = queryOptions({
  queryKey: ["account", "session"],
  queryFn: async () => {
    const { data } = await authClient.getSession({ query: { disableCookieCache: true } })
    return data ?? null
  }
})

/** The signed-in User's settings. The API decides whether the User is active. */
export function AccountSettings() {
  const { data: capabilities } = useSuspenseQuery(capabilitiesQuery)
  const { data: session } = useSuspenseQuery(accountSessionQuery)
  if (!capabilities || !session) return null

  return (
    <AccountSettingsTabs
      profile={
        <div className="flex flex-col gap-6">
          <ProfileSettings member={session.user} />
          <LanguageSettings />
        </div>
      }
      security={
        <>
          <PasswordSettings />
          <PasskeySettings />
          <TwoFactorSettings enabled={Boolean(session.user.twoFactorEnabled)} />
          <SessionsSettings currentSessionToken={session.session.token} />
        </>
      }
      notifications={<PushNotificationSettings />}
    />
  )
}

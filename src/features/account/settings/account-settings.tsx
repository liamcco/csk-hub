import { getCapabilities } from "@/core/api-client/capabilities"
import { getFreshRequestSession } from "@/core/auth/session.server"
import { AccountSettingsTabs } from "./account-settings-tabs"
import { PushNotificationSettings } from "./notifications"
import { LanguageSettings, ProfileSettings } from "./profile"
import { PasskeySettings, PasswordSettings, SessionsSettings, TwoFactorSettings } from "./security"

/**
 * The signed-in User's settings. The API decides whether the User is active; the profile, two-factor
 * and session details come from Better Auth's own session, which `/api/auth` keeps serving.
 */
export async function AccountSettings() {
  const [capabilities, session] = await Promise.all([getCapabilities(), getFreshRequestSession()])
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

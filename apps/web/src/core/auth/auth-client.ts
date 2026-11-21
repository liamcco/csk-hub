import { passkeyClient } from "@better-auth/passkey/client"
import { adminPluginOptions } from "@csk-hub/shared/core/auth/permissions"
import {
  adminClient,
  emailOTPClient,
  magicLinkClient,
  twoFactorClient,
  usernameClient
} from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient(),
    usernameClient(),
    emailOTPClient(),
    magicLinkClient(),
    passkeyClient(),
    adminClient(adminPluginOptions)
  ]
})

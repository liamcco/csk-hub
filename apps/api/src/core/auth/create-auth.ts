import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2"
import { i18n, locales } from "@better-auth/i18n"
import { passkey } from "@better-auth/passkey"
import { adminPluginOptions } from "@csk-hub/shared/core/auth/permissions"
import { app } from "@csk-hub/shared/core/config/app"
import { type BetterAuthOptions, type BetterAuthPlugin, betterAuth } from "better-auth"
import { admin, emailOTP, magicLink, openAPI, testUtils, twoFactor, username } from "better-auth/plugins"
import type { db } from "@/core/db"
import { isMariaDb } from "@/core/db/dialect"
import * as schema from "@/core/db/schema/auth"

const authPlugins = [
  username(),
  admin(adminPluginOptions),
  openAPI(),
  twoFactor({
    issuer: app.name,
    otpOptions: {
      async sendOTP({ user, otp }) {
        const { sendTwoFactorOtpEmail } = await import("@/core/email")
        await sendTwoFactorOtpEmail({ email: user.email, otp })
      }
    }
  }),
  passkey(),
  emailOTP({
    disableSignUp: true,
    expiresIn: 60 * 5,
    async sendVerificationOTP({ email, otp, type }) {
      const { sendVerificationOtpEmail } = await import("@/core/email")
      await sendVerificationOtpEmail({ email, otp, type })
    }
  }),
  magicLink({
    disableSignUp: true,
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    async sendMagicLink({ email, url }) {
      const { sendMagicLinkEmail } = await import("@/core/email")
      await sendMagicLinkEmail({ email, url })
    }
  }),
  i18n({
    translations: {
      en: locales.en,
      sv: locales.sv,
      de: locales.de
    }
  })
] as const

export type AuthSettings = {
  database: typeof db
  baseURL: NonNullable<BetterAuthOptions["baseURL"]>
  /** Production requires email verification and omits Better Auth's test utilities. */
  production: boolean
  /** Host-specific plugins, such as Next.js cookie forwarding for Server Actions. */
  hostPlugins?: BetterAuthPlugin[]
  /** Tests only: a fixed secret and re-enabled origin checks. Production reads BETTER_AUTH_SECRET. */
  secret?: string
  advanced?: BetterAuthOptions["advanced"]
}

/**
 * The single Better Auth configuration: Invite-only sign-up, cookies, trusted origins, plugins and
 * session caching. Every host builds its instance here so identity behavior cannot diverge.
 * Creating an instance opens no connection.
 */
export function createAuth({ database, baseURL, production, hostPlugins = [], secret, advanced }: AuthSettings) {
  return betterAuth({
    appName: app.name,
    baseURL,
    ...(secret ? { secret } : {}),
    ...(advanced ? { advanced } : {}),
    database: drizzleAdapter(database, {
      // Joins stay off (Better Auth's default): on MariaDB, Drizzle's relational queries need LATERAL.
      provider: isMariaDb ? "mysql" : "pg",
      schema
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: production,
      sendResetPassword: async ({ user, url }) => {
        const { sendResetPasswordEmail } = await import("@/core/email")
        await sendResetPasswordEmail({ user, url })
      },
      revokeSessionsOnPasswordReset: true
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 300 // 5 minutes
      }
    },
    plugins: [...authPlugins, ...(production ? [] : [testUtils()]), ...hostPlugins]
  } satisfies BetterAuthOptions)
}

export type Auth = ReturnType<typeof createAuth>

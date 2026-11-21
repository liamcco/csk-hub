import { app } from "@csk-hub/shared/core/config/app"
import { ROUTES } from "@csk-hub/shared/core/navigation/site"
import { useTranslations } from "@/core/i18n/translations"
import { usePageTitle } from "@/core/navigation/page-title"
import { Link } from "@/core/navigation/router"
import { ActivationFailed, ActivationForm } from "@/features/account/activation"
import { LoginForm } from "@/features/account/login"
import { PasswordReset, PasswordResetRequest } from "@/features/account/password-reset"
import { TwoFactorForm } from "@/features/account/two-factor"

export function LoginPage() {
  const t = useTranslations("Public.login")
  usePageTitle(t("pageTitle"))
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-2xl tracking-normal">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </header>
      <LoginForm />
    </>
  )
}

export function TwoFactorPage() {
  const t = useTranslations("Public.twoFactor")
  usePageTitle(t("pageTitle"))
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-2xl tracking-normal">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </header>
      <TwoFactorForm />
    </>
  )
}

export function ActivatePage() {
  usePageTitle(useTranslations("Public.activation")("pageTitle"))
  return <ActivationForm />
}

export function ActivationFailedPage() {
  usePageTitle(useTranslations("Public.activationFailed")("pageTitle"))
  return <ActivationFailed />
}

export function ForgotPasswordPage() {
  usePageTitle(useTranslations("Public.passwordReset")("requestPageTitle"))
  return <PasswordResetRequest />
}

export function ResetPasswordPage() {
  usePageTitle(useTranslations("Public.passwordReset")("resetPageTitle"))
  return <PasswordReset />
}

const articleClass =
  "relative left-1/2 w-[min(56rem,calc(100vw-2rem))] -translate-x-1/2 space-y-6 text-sm leading-relaxed"

export function PrivacyPage() {
  const t = useTranslations("Public.info")
  usePageTitle(t("privacyTitle"))
  return (
    <article className={articleClass}>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{t("privacyTitle")}</h1>
        <p>{t("privacyIntro")}</p>
      </header>
      <section className="space-y-2">
        <h2 className="font-semibold">{t("dataTitle")}</h2>
        <p>{t("dataBody")}</p>
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">{t("technicalTitle")}</h2>
        <p>{t("technicalBody")}</p>
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">{t("contactTitle")}</h2>
        <p>{t("privacyContact")}</p>
        <a href={`mailto:${app.contactEmail}`} className="break-all underline underline-offset-4">
          {app.contactEmail}
        </a>
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">{t("idTitle")}</h2>
        <p>{t("idBody")}</p>
        <p>{t("appSession")}</p>
      </section>
    </article>
  )
}

export function SupportPage() {
  const t = useTranslations("Public.info")
  usePageTitle(t("supportTitle"))
  return (
    <article className={articleClass}>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{t("supportTitle")}</h1>
        <p>{t("supportIntro")}</p>
      </header>
      <section className="space-y-2">
        <h2 className="font-semibold">{t("contactTitle")}</h2>
        <a href={`mailto:${app.contactEmail}`} className="break-all underline underline-offset-4">
          {app.contactEmail}
        </a>
        <p>{t("supportDetails")}</p>
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">{t("loginHelpTitle")}</h2>
        <p>{t("loginHelpBody")}</p>
        <Link href={ROUTES.forgotPassword} className="block underline underline-offset-4">
          {t("resetPassword")}
        </Link>
        <Link href={ROUTES.login} className="block underline underline-offset-4">
          {t("signIn")}
        </Link>
      </section>
    </article>
  )
}

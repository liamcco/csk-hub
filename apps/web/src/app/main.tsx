import "@fontsource-variable/inter"
import "@fontsource-variable/geist-mono"
import "./globals.css"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { ThemeProvider } from "@wrksz/themes"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { reloadSession } from "@/core/auth/session"
import { I18nProvider, initialBrowserLocale, loadMessages } from "@/core/i18n/client"
import { Toaster } from "@/shared/ui/base/toast"
import { createQueryClient } from "./query-client"
import { createAppRouter } from "./router"

// A read on screen answering 401: reload the session and let the router re-check the page's access.
const queryClient = createQueryClient(() => void reloadSession(queryClient).then(() => router.invalidate()))
const router = createAppRouter(queryClient)

const locale = initialBrowserLocale()
document.documentElement.lang = locale
const messages = await loadMessages(locale)

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider initial={{ locale, messages }}>
        <ThemeProvider>
          <RouterProvider router={router} />
          <Toaster />
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>
)

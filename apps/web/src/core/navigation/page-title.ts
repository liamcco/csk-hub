import { app } from "@csk-hub/shared/core/config/app"
import { useEffect } from "react"

/** Titles the browser tab "Page · CSK Hub", or just "CSK Hub" without a page title. */
export function usePageTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${app.name}` : app.name
    return () => {
      document.title = app.name
    }
  }, [title])
}

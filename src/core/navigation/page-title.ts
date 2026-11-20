import { useEffect } from "react"
import { app } from "@/core/config/app"

/** Titles the browser tab "Page · CSK Hub", or just "CSK Hub" without a page title. */
export function usePageTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} · ${app.name}` : app.name
    return () => {
      document.title = app.name
    }
  }, [title])
}

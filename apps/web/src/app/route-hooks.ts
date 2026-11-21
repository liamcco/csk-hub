import { useParams, useSearch } from "@tanstack/react-router"
import type { ReactNode } from "react"

/** A page's screen and loading state, loaded with its route's code chunk. */
export type Screen = { component: () => ReactNode; pending?: () => ReactNode }

/** A path parameter of the current page. */
export function useParam(name: string): string {
  return (useParams({ strict: false }) as Record<string, string>)[name] ?? ""
}

/** The current page's query string, as plain values. */
export function useSearchLoose(): Record<string, unknown> {
  return useSearch({ strict: false }) as Record<string, unknown>
}

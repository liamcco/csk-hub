import { type CurrentCapabilities, getCurrentCapabilities } from "@contract/client"
import { queryOptions, useQuery } from "@tanstack/react-query"
import { browserApiClient } from "./browser"
import { read } from "./result"

/**
 * The signed-in User's name, photo, saved locale and application-wide capabilities. They are UI
 * hints for the shell and page gates only: every API operation enforces authority again.
 */
export const capabilitiesQuery = queryOptions({
  queryKey: ["capabilities"],
  queryFn: () => read(getCurrentCapabilities({ client: browserApiClient }))
})

/** The current capabilities, or undefined while they load or when signed out. */
export function useCapabilities(): CurrentCapabilities | undefined {
  return useQuery(capabilitiesQuery).data
}

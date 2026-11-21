import { listUsers } from "@csk-hub/contract/client"
import { queryOptions } from "@tanstack/react-query"
import { browserApiClient as client } from "@/core/api-client/browser"
import { read } from "@/core/api-client/result"
import type { UserListItem } from "./user-list"

export const usersQuery = queryOptions({
  queryKey: ["users"],
  queryFn: async (): Promise<UserListItem[]> =>
    (await read(listUsers({ client }))).items.map((item) => ({ ...item, createdAt: new Date(item.createdAt) }))
})

import { describe, expect, mock, test } from "bun:test"
import messages from "@messages/en.json"
import swedishMessages from "@messages/sv.json"
import { renderToStaticMarkup } from "react-dom/server"
import { app } from "@/core/config/app"
import { IntlProvider } from "@/core/i18n/client"
import type { UserListItem } from "./service"

const navigation = await import("@/core/navigation/router")
mock.module("@/core/navigation/router", () => ({ ...navigation, useAppRouter: () => ({ refresh: () => {} }) }))
const { UserList } = await import("./user-list")

describe("UserList", () => {
  test("formats the table caption with the application name", () => {
    const markup = renderToStaticMarkup(
      <IntlProvider locale="en" messages={messages}>
        <UserList users={[]} />
      </IntlProvider>
    )

    expect(markup).toContain(`Manage everyone with access to ${app.name}.`)
  })

  test("formats joined dates with the provider locale and time zone", () => {
    const member = {
      id: "member-1",
      name: "Ada Lovelace",
      username: null,
      email: "ada@example.com",
      emailVerified: true,
      hasPassword: true,
      role: "member",
      inactive: false,
      createdAt: new Date("2026-09-08T23:30:00-02:00")
    } satisfies UserListItem
    const markup = renderToStaticMarkup(
      <IntlProvider locale="sv" messages={swedishMessages} timeZone="UTC">
        <UserList users={[member]} />
      </IntlProvider>
    )

    expect(markup).toContain("2026-09-09")
  })
})

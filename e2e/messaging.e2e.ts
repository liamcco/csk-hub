import { expect, test } from "@playwright/test"
import { fixtures, signIn } from "./support"

const { alto, tenor } = fixtures

test("members exchange Direct Messages, with unread state cleared once read", async ({ browser }) => {
  const opening = `Can you sing T2 on Sunday? ${Date.now()}`
  const sender = await browser.newPage()
  await signIn(sender, alto)
  await sender.goto(`/members/${tenor.id}`)
  await sender.getByRole("button", { name: "Message" }).click()
  const dialog = sender.getByRole("dialog")
  await dialog.getByLabel("First message").fill(opening)
  const start = sender.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/conversations"
  )
  await dialog.getByRole("button", { name: "Send message" }).click()
  await start
  await expect(sender).toHaveURL(/\/messages\/[0-9a-f-]+$/)
  await expect(sender.getByText(opening).filter({ visible: true })).toBeVisible()
  const conversationPath = new URL(sender.url()).pathname

  const recipient = await browser.newPage()
  await signIn(recipient, tenor)
  await recipient.goto("/messages")
  const row = recipient.getByRole("listitem").filter({ hasText: opening })
  await expect(row.getByText("1 unread")).toBeVisible()
  const read = recipient.waitForRequest((request) => request.url().endsWith("/read"))
  await row.getByRole("link").click()
  await read
  await recipient.getByLabel("Message", { exact: true }).fill("Yes, count me in")
  await recipient.getByRole("button", { name: "Send message" }).click()
  await expect(recipient.getByText("Yes, count me in").filter({ visible: true })).toBeVisible()
  await recipient.goto("/messages")
  await expect(
    recipient
      .getByRole("listitem")
      .filter({ hasText: "Yes, count me in" })
      .getByText(/unread/)
  ).toHaveCount(0)

  await sender.goto(conversationPath)
  await expect(sender.getByText("Yes, count me in").filter({ visible: true })).toBeVisible()
})

test("a member outside a Conversation cannot open it", async ({ browser }) => {
  const sender = await browser.newPage()
  await signIn(sender, tenor)
  await sender.goto("/messages")
  const link = sender.locator(`main a[href^="/messages/"]`).first()
  await expect(link).toBeVisible()
  const href = (await link.getAttribute("href")) ?? ""

  const outsider = await browser.newPage()
  await signIn(outsider, fixtures.admin)
  await outsider.goto(href)
  await expect(outsider.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible()
})

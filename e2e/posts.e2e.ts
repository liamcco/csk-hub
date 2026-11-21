import { expect, test } from "@playwright/test"
import { fixtures, signIn, writePost as write } from "./support"

const { alto, tenor, admin } = fixtures

test("a published Post reaches another member's feed as unread until they open it", async ({ browser }) => {
  const title = `Rehearsal moved ${Date.now()}`
  const author = await browser.newPage()
  await signIn(author, alto)
  await write(author, title, "Publish")
  await expect(author.getByRole("heading", { level: 1, name: title })).toBeVisible()

  const reader = await browser.newPage()
  await signIn(reader, tenor)
  await reader.goto("/news")
  const card = reader.getByRole("listitem").filter({ hasText: title })
  await expect(card.getByText("Unread", { exact: true })).toBeVisible()

  const read = reader.waitForRequest((request) => request.url().endsWith("/read"))
  await card.getByRole("link").click()
  await read
  await expect(reader.getByRole("heading", { level: 1, name: title })).toBeVisible()
  await reader.goto("/news")
  await expect(
    reader.getByRole("listitem").filter({ hasText: title }).getByText("Unread", { exact: true })
  ).toHaveCount(0)
})

test("a Draft stays private to its author, even from an Admin", async ({ browser }) => {
  const title = `Private draft ${Date.now()}`
  const author = await browser.newPage()
  await signIn(author, alto)
  await write(author, title, "Save draft")
  await expect(author).toHaveURL(/\/news\/[^/]+\/edit$/)
  const editPath = new URL(author.url()).pathname

  await author.goto("/news")
  await expect(author.getByRole("region", { name: "Your drafts" }).getByText(title)).toBeVisible()

  const other = await browser.newPage()
  await signIn(other, admin)
  await other.goto("/news")
  await expect(other.getByText(title)).toHaveCount(0)
  await other.goto(editPath)
  await expect(other.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible()
  await expect(other.getByRole("textbox", { name: "Title", exact: true })).toHaveCount(0)
})

test("an Admin recalls another member's Post back to its author's drafts", async ({ browser }) => {
  const title = `Recall me ${Date.now()}`
  const author = await browser.newPage()
  await signIn(author, tenor)
  await write(author, title, "Publish")
  await expect(author.getByRole("heading", { level: 1, name: title })).toBeVisible()
  const postPath = new URL(author.url()).pathname
  await expect(author.getByRole("button", { name: "Unpublish" })).toBeVisible()

  const moderator = await browser.newPage()
  await signIn(moderator, admin)
  await moderator.goto(postPath)
  await moderator.getByRole("button", { name: "Unpublish" }).click()
  await moderator.getByRole("alertdialog").getByRole("button", { name: "Unpublish" }).click()
  await expect(moderator).toHaveURL(/\/news$/)
  await expect(moderator.getByText("Post unpublished")).toBeVisible()

  // Next keeps the previous page mounted but hidden, so only visible text counts.
  await expect(moderator.getByText(title).filter({ visible: true })).toHaveCount(0)

  await author.goto("/news")
  await expect(author.getByRole("region", { name: "Your drafts" }).getByText(title)).toBeVisible()
})

test("a member cannot change someone else's published Post", async ({ page }) => {
  const title = `Not yours ${Date.now()}`
  await signIn(page, alto)
  await write(page, title, "Publish")
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible()
  const postPath = new URL(page.url()).pathname

  await page.context().clearCookies()
  await signIn(page, tenor)
  await page.goto(postPath)
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible()
  await expect(page.getByRole("button", { name: "Unpublish" })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0)
})

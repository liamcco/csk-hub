import { expect, test } from "@playwright/test"
import { fixtures, signIn } from "./support"

const { admin, alto } = fixtures

test("an Admin drafts an Event and publishes it through the API", async ({ page }) => {
  const title = `Section meeting ${Date.now()}`
  const year = new Date().getFullYear() + 1
  await signIn(page, admin)
  await page.goto("/events/manage/new")
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(title)
  await page.locator(`input[name="startsAt"]:visible`).fill(`${year}-04-02T18:00`)
  await page.locator(`input[name="endsAt"]:visible`).fill(`${year}-04-02T20:00`)
  const created = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/events/manage"
  )
  await page.getByRole("button", { name: "Save Draft" }).click()
  expect((await created).status()).toBe(201)
  await expect(page).toHaveURL(/\/events\/manage\/[0-9a-f-]+$/)
  const managementPath = new URL(page.url()).pathname

  await page.getByRole("button", { name: "Publish", exact: true }).click()
  const published = page.waitForResponse((response) => response.url().endsWith("/status"))
  await page.getByRole("dialog").getByRole("button", { name: "Publish", exact: true }).click()
  expect((await published).status()).toBe(200)
  await expect(page.getByText("Event published.").filter({ visible: true })).toBeVisible()

  await page.goto("/events/manage")
  await expect(page.getByText(title).filter({ visible: true })).toBeVisible()
  await page.goto("/")
  await expect(page.getByText(title).filter({ visible: true }).first()).toBeVisible()

  await page.context().clearCookies()
  await signIn(page, alto)
  await page.goto(managementPath)
  await expect(page.getByRole("heading", { level: 2, name: "This page could not be found." })).toBeVisible()
})

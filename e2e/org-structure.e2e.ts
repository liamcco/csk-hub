import { expect, test } from "@playwright/test"
import { fixtures, signIn } from "./support"

const { admin, alto } = fixtures

test("an Admin creates a group through the API and opens it", async ({ page }) => {
  const name = `Kommitté ${Date.now()}`
  await signIn(page, admin)
  await page.goto("/admin/org-structure/groups")

  await page.getByRole("button", { name: "Create group" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Name").fill(name)
  const created = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/groups"
  )
  await dialog.getByRole("button", { name: "Create group" }).click()
  expect((await created).status()).toBe(201)
  await expect(page.getByText("Saved", { exact: true }).filter({ visible: true })).toBeVisible()

  await page.getByRole("link", { name }).filter({ visible: true }).first().click()
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible()
})

test("an ordinary member cannot open the organisation administration", async ({ page }) => {
  await signIn(page, alto)
  await page.goto("/admin/org-structure")
  await expect(page.getByRole("heading", { level: 1, name: "No access" })).toBeVisible()
  expect((await page.request.get("/api/v1/groups")).status()).toBe(403)
})

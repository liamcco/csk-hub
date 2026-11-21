import { expect, test } from "@playwright/test"
import { fixtures, signIn } from "./support"

const { admin } = fixtures

function apiCall(method: string, pathname: RegExp | string) {
  return (response: { request(): { method(): string }; url(): string }) => {
    const path = new URL(response.url()).pathname
    return (
      response.request().method() === method && (typeof pathname === "string" ? path === pathname : pathname.test(path))
    )
  }
}

test("an Admin invites a member and deactivates them through the API", async ({ page }) => {
  const name = `Invited ${Date.now()}`
  await signIn(page, admin)
  await page.goto("/admin/users")

  await page.getByRole("button", { name: "Add member" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Name").fill(name)
  await dialog.getByLabel("Email").fill(`${Date.now()}@example.test`)
  const invited = page.waitForResponse(apiCall("POST", "/api/v1/users"))
  await dialog.getByRole("button", { name: "Add member" }).click()
  expect((await invited).status()).toBe(201)
  await expect(page.getByText("Invite sent").filter({ visible: true })).toBeVisible()
  await page.keyboard.press("Escape")

  await page
    .getByRole("button", { name: `Actions for ${name}` })
    .filter({ visible: true })
    .first()
    .click()
  await page.getByRole("menuitem", { name: "Deactivate" }).click()
  const deactivated = page.waitForResponse(apiCall("POST", /\/api\/v1\/users\/[^/]+\/deactivate$/))
  await page.getByRole("alertdialog").getByRole("button", { name: "Deactivate" }).click()
  expect((await deactivated).status()).toBe(200)
  await expect(page.getByText("Member deactivated").filter({ visible: true })).toBeVisible()
})

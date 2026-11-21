import { expect, test } from "@playwright/test"
import { fixtures, signIn, sql } from "./support"

const { deputy } = fixtures

test("a member saves their language through the API", async ({ page }) => {
  await signIn(page, deputy)
  await page.goto("/me/settings")
  await expect(page.getByText("Language").filter({ visible: true }).first()).toBeVisible()

  const saved = page.waitForResponse(
    (response) => response.request().method() === "PUT" && new URL(response.url()).pathname === "/api/v1/account/locale"
  )
  await page.getByRole("combobox", { name: "Language" }).filter({ visible: true }).first().click()
  await page.getByRole("option", { name: "Svenska" }).click()
  expect((await saved).status()).toBe(204)
  await expect(page.getByText("Språk").filter({ visible: true }).first()).toBeVisible()

  const stored = await sql("select preferences from user_preferences where user_id = $1", [deputy.id])
  expect(stored.rows[0]?.preferences).toMatchObject({ locale: "sv" })
  await sql("delete from user_preferences where user_id = $1", [deputy.id])
})

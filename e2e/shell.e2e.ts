import { expect, test } from "@playwright/test"
import { fixtures, signIn, sql } from "./support"

const { alto, deputy } = fixtures
const primary = (page: import("@playwright/test").Page) => page.getByRole("navigation", { name: "Primary navigation" })

test("an ordinary member has no administration link and cannot open administration", async ({ page }) => {
  await signIn(page, alto)
  await page.goto("/members")

  await expect(primary(page).getByRole("link", { name: "Members" })).toBeVisible()
  await expect(primary(page).getByRole("link", { name: "Admin" })).toHaveCount(0)
  // The SPA serves every web path; the page shows the denial and the API refuses the read itself.
  await page.goto("/admin/users")
  await expect(page.getByRole("heading", { level: 1, name: "No access" })).toBeVisible()
  expect((await page.request.get("/api/v1/users")).status()).toBe(403)
})

test("a demoted Admin loses administration on their next page load", async ({ page }) => {
  await signIn(page, deputy)
  await page.goto("/admin")
  await expect(primary(page).getByRole("link", { name: "Admin" })).toBeVisible()

  await sql(`update "user" set role = 'user' where id = $1`, [deputy.id])
  await page.goto("/members")

  await expect(primary(page).getByRole("link", { name: "Members" })).toBeVisible()
  await expect(primary(page).getByRole("link", { name: "Admin" })).toHaveCount(0)
})

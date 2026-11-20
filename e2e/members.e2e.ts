import { expect, test } from "@playwright/test"
import { fixtures, signIn, sql } from "./support"

const { alto, tenor, admin, leaver } = fixtures

test("a member finds another member in the directory and opens their profile", async ({ page }) => {
  await signIn(page, alto)

  await page.goto("/members")
  await page.getByLabel("Find a member").fill("Tenor")
  await page.getByLabel("Find a member").press("Enter")
  await page.getByRole("link", { name: /Tenor Tor/ }).click()

  await expect(page.getByRole("heading", { level: 1, name: "Tenor Tor" })).toBeVisible()
  await expect(page.getByText(tenor.email)).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Edit profile" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Message" })).toBeVisible()
})

test("a member edits their own voices through the API", async ({ page }) => {
  await signIn(page, alto)
  await page.goto("/me")
  await expect(page.getByText(alto.email)).toBeVisible()
  await page.getByRole("link", { name: "Edit profile" }).click()

  await page.getByText("A2", { exact: true }).click()
  const save = page.waitForRequest(
    (request) => request.method() === "PUT" && new URL(request.url()).pathname === "/api/v1/profile/voices"
  )
  await page.getByRole("button", { name: "Save profile" }).click()
  expect((await save).postDataJSON()).toEqual({ voices: ["A2"] })
  await expect(page.getByRole("status").filter({ hasText: "Your profile has been saved." })).toBeVisible()

  await page.goto("/me")
  await expect(page.getByRole("region", { name: "Can sing" }).getByText("A2", { exact: true })).toBeVisible()
})

test("an Admin has no implicit right to edit another member's profile", async ({ page }) => {
  await signIn(page, admin)
  await page.goto(`/members/${alto.id}`)

  await expect(page.getByRole("heading", { level: 1, name: "Alto Anna" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Edit profile" })).toHaveCount(0)
  await expect(page.getByText(alto.email)).toHaveCount(0)
})

test("a deactivation applies to the member's very next request", async ({ page }) => {
  await signIn(page, leaver)
  await page.goto("/me/edit")
  await expect(page.getByRole("button", { name: "Save profile" })).toBeVisible()

  await sql(`update "user" set banned = true where id = $1`, [leaver.id])
  await page.getByText("B1", { exact: true }).click()
  await page.getByRole("button", { name: "Save profile" }).click()

  await expect(page.getByText("Sign in to edit your profile.")).toBeVisible()
  await page.goto(`/members/${alto.id}`)
  await expect(page.getByRole("heading", { level: 1, name: "Alto Anna" })).toHaveCount(0)
})

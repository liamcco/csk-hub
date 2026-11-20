import { expect, test } from "@playwright/test"
import { fixtures, signIn } from "./support"

const { admin } = fixtures

test("an Admin sends a broadcast through the API and sees how delivery went", async ({ page }) => {
  await signIn(page, admin)
  await page.goto("/admin/notifications")

  const card = page.locator("[data-slot=card]").filter({ hasText: "Broadcast to all" })
  await card.getByRole("textbox").fill("Rehearsal moved to Aula")
  const sent = page.waitForResponse(
    (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/broadcasts"
  )
  await card.getByRole("button", { name: "Send to all" }).click()
  expect((await sent).status()).toBe(200)
  // The journey database has no push subscriptions and no real-time delivery.
  await expect(card.getByText("No active notification subscriptions.")).toBeVisible()
})

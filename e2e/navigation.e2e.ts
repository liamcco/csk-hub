import { expect, type Page, test } from "@playwright/test"
import { fixtures, signIn, writePost } from "./support"

const { alto, tenor } = fixtures

const primary = (page: Page) => page.getByRole("navigation", { name: "Primary navigation" })
const skeletons = (page: Page) => page.locator('[data-slot="skeleton"]')
/** Long enough that a page waiting for the response would still show its loading state. */
const SLOW_API_MS = 5_000

/** Holds back every API response whose path starts with `path`; counts the requests. */
async function slowDown(page: Page, path: string) {
  const requests = { count: 0 }
  await page.route(
    (url) => url.pathname.startsWith(path),
    async (route) => {
      requests.count++
      await new Promise((resolve) => setTimeout(resolve, SLOW_API_MS))
      await route.continue()
    }
  )
  return requests
}

test("revisiting a page while its API response is slow shows the cached page and refreshes it", async ({ page }) => {
  await signIn(page, alto)
  await page.goto("/members")
  const member = page.getByRole("link", { name: /Tenor Tor/ })
  await expect(member).toBeVisible()

  await primary(page).getByRole("link", { name: "News", exact: true }).click()
  await expect(page).toHaveURL(/\/news$/)
  // Suspense queries count as fresh for their first second; after that a revisit refreshes them.
  await page.waitForTimeout(1_500)
  const refreshes = await slowDown(page, "/api/v1/members")
  await page.goBack()

  await expect(member).toBeVisible({ timeout: 1_000 })
  await expect(skeletons(page)).toHaveCount(0)
  await expect.poll(() => refreshes.count).toBeGreaterThan(0)
})

test("navigating between pages does not request the session again", async ({ page }) => {
  await signIn(page, alto)
  await page.goto("/members")
  await expect(page.getByRole("link", { name: /Tenor Tor/ })).toBeVisible()

  const sessionReads: string[] = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/auth/get-session") sessionReads.push(request.url())
  })
  for (const [name, path] of [
    ["News", /\/news$/],
    ["Events", /\/events$/],
    ["Members", /\/members$/]
  ] as const) {
    await primary(page).getByRole("link", { name, exact: true }).click()
    await expect(page).toHaveURL(path)
  }
  await page.goBack()
  await expect(page).toHaveURL(/\/events$/)

  expect(sessionReads).toEqual([])
})

test("a link preloaded on intent opens without a loading state", async ({ page }) => {
  await signIn(page, alto)
  await page.goto("/members")
  await expect(page.getByRole("link", { name: /Tenor Tor/ })).toBeVisible()

  const events = primary(page).getByRole("link", { name: "Events", exact: true })
  const preloaded = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/events/upcoming")
  await events.hover()
  await preloaded
  // Any read the page still waited for would now keep it loading.
  await slowDown(page, "/api/v1/events")
  await events.click()

  await expect(page).toHaveURL(/\/events$/)
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 1_000 })
  await expect(skeletons(page)).toHaveCount(0)
})

test("a real-time event updates an open page without a reload", async ({ browser }) => {
  test.skip(!process.env.REDIS_URL && !process.env.E2E_STACK, "Real-time delivery needs Redis (REDIS_URL).")
  const reader = await browser.newPage()
  await signIn(reader, tenor)
  await reader.goto("/news")
  await expect(reader.getByRole("heading", { level: 1, name: "News" })).toBeVisible()
  await reader.evaluate(() => Object.assign(window, { journeyMarker: "same document" }))

  const title = `Live news ${Date.now()}`
  const author = await browser.newPage()
  await signIn(author, alto)
  await writePost(author, title, "Publish")

  await expect(reader.getByRole("listitem").filter({ hasText: title })).toBeVisible({ timeout: 15_000 })
  expect(await reader.evaluate(() => (window as unknown as { journeyMarker?: string }).journeyMarker)).toBe(
    "same document"
  )
})

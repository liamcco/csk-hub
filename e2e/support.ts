import { readFileSync } from "node:fs"
import { expect, type Page } from "@playwright/test"
import { Client } from "pg"
import { E2E_ORIGIN, E2E_PASSWORD, type E2EFixtures, type E2EUser } from "./fixtures"

function required(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is unset. Run the journeys with \`bun run e2e\`.`)
  return value
}

export const fixtures: E2EFixtures = JSON.parse(readFileSync(required("E2E_FIXTURES"), "utf8"))

/** Signs in through the login screen, in English, as a member would. */
export async function signIn(page: Page, user: E2EUser) {
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: E2E_ORIGIN }])
  await page.goto("/login")
  await page.getByLabel("Email or username").fill(user.email)
  await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD)
  // The stack keeps Better Auth's sign-in rate limit, and every journey signs in from one address:
  // wait out a 429 as a member would.
  for (let attempt = 1; ; attempt++) {
    const answered = page.waitForResponse((response) =>
      new URL(response.url()).pathname.startsWith("/api/auth/sign-in")
    )
    await page.getByRole("button", { name: "Sign in", exact: true }).click()
    const response = await answered
    if (response.status() !== 429 || attempt === 5) break
    await page.waitForTimeout(Number(response.headers()["x-retry-after"] ?? 10) * 1000)
  }
  await expect(page).not.toHaveURL(/\/login/)
}

/** Runs SQL against the journey database, standing in for another Admin's change. */
export async function sql(text: string, values: unknown[] = []) {
  const client = new Client({ connectionString: required("E2E_DATABASE_URL") })
  await client.connect()
  try {
    return await client.query(text, values)
  } finally {
    await client.end()
  }
}

/** Writes a Post through the composer and saves it as a draft or publishes it. */
export async function writePost(page: Page, title: string, button: "Save draft" | "Publish") {
  await page.goto("/news/new")
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(title)
  await page.getByRole("textbox").last().click()
  await page.keyboard.type(`${title} body text`)
  const write = page.waitForRequest((request) => new URL(request.url()).pathname.startsWith("/api/v1/posts"))
  await page.getByRole("button", { name: button, exact: true }).click()
  expect((await write).method()).toBe("POST")
}

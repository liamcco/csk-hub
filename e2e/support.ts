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
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
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

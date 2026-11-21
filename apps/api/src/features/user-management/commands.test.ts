import { afterAll, describe, expect, mock, test } from "bun:test"
import { eq } from "drizzle-orm"
import { user } from "@/core/db/schema/auth"
import type { AuthApi } from "@/core/http"
import { createTestDatabase } from "../../../test/database"
import { changeUserRoleCommand, deactivateUserCommand, eraseUserCommand, type UserAdministration } from "./commands"

const database = await createTestDatabase()

// Over HTTP the acting Admin is always another active Admin, so the last-Admin guard only fires
// when that Admin's authority changes mid-request. These tests reach it through the commands,
// with an actor the database does not count as an Admin.
describe.skipIf(!database)("the last remaining Admin", () => {
  const t = database as NonNullable<typeof database>
  afterAll(() => t.drop())
  const banUser = mock(async () => undefined)
  const removeUser = mock(async () => undefined)
  const setRole = mock(async () => undefined)
  const context: UserAdministration = {
    database: t?.db,
    authApi: { banUser, removeUser, setRole } as unknown as AuthApi,
    headers: new Headers(),
    actorId: crypto.randomUUID()
  }

  async function adminUser(name: string, banned = false) {
    const id = crypto.randomUUID()
    await t.db.insert(user).values({ id, name, email: `${id}@example.test`, role: "admin", banned })
    return id
  }

  test("cannot be deactivated, demoted or erased", async () => {
    const last = await adminUser("Last Admin")

    expect(await deactivateUserCommand(context, last)).toEqual({ ok: false, error: "LAST_ADMIN" })
    expect(await changeUserRoleCommand(context, last, ["user"])).toEqual({ ok: false, error: "LAST_ADMIN" })
    await t.db.update(user).set({ banned: true }).where(eq(user.id, last))
    expect(await eraseUserCommand(context, last, "delete Last Admin")).toEqual({ ok: false, error: "LAST_ADMIN" })
    expect(banUser).not.toHaveBeenCalled()
    expect(setRole).not.toHaveBeenCalled()
    expect(removeUser).not.toHaveBeenCalled()
  })

  test("an inactive Admin does not count as another Admin for deactivation or demotion", async () => {
    const active = await adminUser("Active Admin")

    expect(await deactivateUserCommand(context, active)).toEqual({ ok: false, error: "LAST_ADMIN" })
    expect(await changeUserRoleCommand(context, active, ["user"])).toEqual({ ok: false, error: "LAST_ADMIN" })

    await adminUser("Second Admin")
    expect(await changeUserRoleCommand(context, active, ["user"])).toEqual({ ok: true })
    expect(setRole).toHaveBeenCalledTimes(1)
  })
})

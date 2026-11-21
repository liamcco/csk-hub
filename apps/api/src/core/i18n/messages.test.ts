import { describe, expect, test } from "bun:test"

const { getMessages } = await import("@csk-hub/shared/core/i18n/messages")

describe("root metadata messages", () => {
  test("provides a localized description for every supported locale", () => {
    expect(getMessages("en").Metadata.description).toBe("The digital hub for Chalmers Sångkör")
    expect(getMessages("sv").Metadata.description).toBe("Chalmers Sångkörs digitala nav")
    expect(getMessages("de").Metadata.description).toBe("Das digitale Zentrum von Chalmers Sångkör")
  })
})

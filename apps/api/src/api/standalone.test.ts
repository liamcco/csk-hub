import { describe, expect, test } from "bun:test"

describe("standalone API", () => {
  test("bundles without Next.js", async () => {
    // The same build the release image runs for api.js.
    const build = await Bun.build({
      entrypoints: [new URL("server.ts", import.meta.url).pathname],
      target: "bun",
      conditions: ["react-server"],
      external: ["pg-native"],
      metafile: true,
      throw: false
    })
    expect(build.logs.filter((log) => log.level === "error").map(String)).toEqual([])
    const inputs = Object.keys(build.metafile?.inputs ?? {})
    expect(inputs.length).toBeGreaterThan(0)
    expect(inputs.filter((input) => /node_modules\/next\//.test(input))).toEqual([])
  }, 60_000)
})

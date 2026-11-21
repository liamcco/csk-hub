import { beforeAll, describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { projectFiles } from "archunit"

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

function projectPath(file: string): string {
  return relative(process.cwd(), file).split(sep).join("/")
}

/** The feature a file belongs to, or null when it sits outside `src/features`. */
function featureOwning(file: string): string | null {
  return projectPath(file).match(/^src\/features\/([\w.-]+)\//)?.[1] ?? null
}

/**
 * Subfeature entrypoints are legitimate targets, so a path counts as public when the
 * directory it names has an `index.ts`. Anything else is a deep implementation import.
 */
function isEntrypoint(feature: string, subpath: string): boolean {
  const normalizedSubpath = subpath.replace(/^\/+/, "")
  return existsSync(join("src/features", feature, normalizedSubpath, "index.ts"))
}

describe("Architecture Rules", () => {
  // Archunit parses the project once and caches the graph for every later rule. Pay for
  // that parse here, under a timeout sized for it, rather than in whichever rule runs first.
  beforeAll(async () => {
    await projectFiles().inPath("src/**").shouldNot().dependOnFiles().inPath("node_modules/**").check()
  }, 30_000)

  test("only core i18n imports use-intl", () => {
    const violations = sourceFiles("src")
      .filter((file) => !projectPath(file).startsWith("src/core/i18n/"))
      .filter((file) => /from\s+["']use-intl(?:\/[^"']+)?["']/.test(readFileSync(file, "utf8")))
      .map(projectPath)

    expect(violations).toEqual([])
  })

  test("should not have circular dependencies", async () => {
    const rule = projectFiles().inFolder("src/**").should().haveNoCycles()
    expect(await rule.check()).toEqual([])
  })

  test("core does not depend on features", async () => {
    const rule = projectFiles().inPath("src/core/**").shouldNot().dependOnFiles().inPath("src/features/**")
    expect(await rule.check()).toEqual([])
  })

  test("features are reached only through a public entrypoint", () => {
    const violations = sourceFiles("src").flatMap((file) => {
      const owner = featureOwning(file)
      return [...readFileSync(file, "utf8").matchAll(/from\s+"@\/features\/([\w.-]+)(\/[^"]+)?"/g)]
        .filter(([, feature, subpath]) => feature !== owner && subpath && !isEntrypoint(feature, subpath))
        .map(([, feature, subpath]) => `${projectPath(file)} -> @/features/${feature}${subpath}`)
    })

    expect(violations).toEqual([])
  })

  test("only the request session helper calls auth.api.getSession", () => {
    const allowedPaths = new Set(["src/core/auth/request-session.ts"])
    const violations = sourceFiles("src")
      .filter((file) => !allowedPaths.has(projectPath(file)))
      .filter((file) => /\bauth\s*\.\s*api\s*\.\s*getSession\s*\(/.test(readFileSync(file, "utf8")))
      .map(projectPath)

    expect(violations).toEqual([])
  })

  test("only the API composition root depends on itself", async () => {
    const violations = await projectFiles()
      .inPath("src/**", { except: { inPath: "src/api/**" } })
      .shouldNot()
      .dependOnFiles()
      .inPath("src/api/**")
      .check()

    expect(violations).toEqual([])
  })
})

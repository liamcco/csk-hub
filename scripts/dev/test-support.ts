import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

/** Runs the dev CLI as a developer would, with `environment` laid over this process's environment. */
export async function runDevCli(args: string[], environment: Record<string, string>) {
  const child = Bun.spawn([process.execPath, "run", "--silent", "db", ...args], {
    cwd: ROOT,
    env: { ...process.env, ...environment },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe"
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ])
  return { code, stdout, stderr }
}

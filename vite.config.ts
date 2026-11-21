import { fileURLToPath } from "node:url"
import babel from "@rolldown/plugin-babel"
import tailwindcss from "@tailwindcss/vite"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import { defineConfig, loadEnv, type Plugin } from "vite"

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

/** Server code the browser bundle must never reach: the API owns the database and secrets. */
const SERVER_ONLY = new Set(["pg", "redis", "web-push", "nodemailer", "drizzle-orm"])

const webOnly: Plugin = {
  name: "csk-hub:web-only",
  enforce: "pre",
  resolveId(id, importer) {
    if (SERVER_ONLY.has(id)) this.error(`${importer ?? "The web app"} imports server code ("${id}").`)
  }
}

/**
 * The web app: a static React SPA in `dist/web`, served by the stack's static web server beside
 * the API under one origin. In development Vite proxies `/api` to the API process (API_DEV_ORIGIN).
 */
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env }
  const apiOrigin = env.API_DEV_ORIGIN ?? "http://localhost:3001"
  return {
    plugins: [webOnly, tailwindcss(), react(), babel({ presets: [reactCompilerPreset()] })],
    resolve: {
      alias: [
        { find: /^@\//, replacement: path("./src/") },
        { find: /^@contract\//, replacement: path("./contract/") },
        { find: /^@messages\//, replacement: path("./messages/") }
      ]
    },
    build: { outDir: "dist/web", emptyOutDir: true, sourcemap: true },
    server: {
      port: Number(env.WEB_DEV_PORT ?? 3000),
      strictPort: true,
      // Event streams pass through unbuffered; the API sees the browser's own Origin.
      proxy: { "/api": { target: apiOrigin, xfwd: true } }
    }
  }
})

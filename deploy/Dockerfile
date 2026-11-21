# syntax=docker/dockerfile:1
#
# The CSK Hub release images, one per application. Build each target from the repository root:
#   docker build -f deploy/Dockerfile --target api .
#       migrate  bun cli.js migrate  (applies pending migrations, grants the runtime role, exits)
#       api      bun api.js          (the standalone Hono API; the default command)
#       and the maintenance CLI (`bun cli.js --help`) for the container's console.
#   docker build -f deploy/Dockerfile --target web --build-arg VITE_VAPID_PUBLIC_KEY=... .
#       web      Caddy serving the SPA's static files, with the API behind it on the same origin.

ARG BUN_VERSION=1.4.3

FROM oven/bun:${BUN_VERSION} AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/contract/package.json packages/contract/
RUN bun install --frozen-lockfile

FROM deps AS source
COPY . .

FROM source AS api-build
RUN bun run --cwd apps/api build

FROM source AS web-build
# Inlined into the browser bundle; must match the VAPID_PUBLIC_KEY the API runs with.
ARG VITE_VAPID_PUBLIC_KEY
RUN test -n "$VITE_VAPID_PUBLIC_KEY" || { echo "Build with --build-arg VITE_VAPID_PUBLIC_KEY=<the stack's VAPID_PUBLIC_KEY>." >&2; exit 1; }
ENV VITE_VAPID_PUBLIC_KEY=${VITE_VAPID_PUBLIC_KEY}
RUN bun run --cwd apps/web build

FROM oven/bun:${BUN_VERSION}-slim AS api
WORKDIR /app
ENV NODE_ENV=production \
    ENVIRONMENT=production \
    PORT=3000
COPY --from=api-build /app/apps/api/dist/api.js /app/apps/api/dist/cli.js ./
COPY --from=api-build /app/apps/api/drizzle ./drizzle
USER bun
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["bun", "-e", "const r = await fetch('http://127.0.0.1:3000/api/auth/ok'); process.exit(r.ok ? 0 : 1)"]
CMD ["bun", "api.js"]

FROM caddy:2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/apps/web/dist /srv
EXPOSE 8443

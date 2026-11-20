# syntax=docker/dockerfile:1
#
# The CSK Hub release image. One Bun image serves every Compose container:
#   web      bun server.js          (the default command: the Next.js web server)
#   api      bun api.js             (the standalone Hono API; no Next.js)
#   migrate  bun cli.js migrate     (applies pending migrations, grants the runtime role, exits)
# and carries the maintenance CLI (`bun cli.js --help`) for the app container's console.
#
# Build from the repository root:  docker build -f deploy/Dockerfile .

ARG BUN_VERSION=1.4.3

FROM oven/bun:${BUN_VERSION} AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS build
COPY . .
# Inlined into the browser bundle at build time; must match the VAPID_PUBLIC_KEY the stack runs with.
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
RUN test -n "$NEXT_PUBLIC_VAPID_PUBLIC_KEY" || { echo "Build with --build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY=<the stack's VAPID_PUBLIC_KEY>." >&2; exit 1; }
ENV NEXT_TELEMETRY_DISABLED=1 \
    ENVIRONMENT=production \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=${NEXT_PUBLIC_VAPID_PUBLIC_KEY}
# `next build` loads the validated configuration and web-push checks the VAPID key format at
# import. Throwaway secrets satisfy both for this one step and stay out of the image; nothing
# connects during the build, and the stack supplies the real values at runtime.
RUN POSTGRES_URL=postgresql://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET="$(head -c 32 /dev/urandom | base64)" \
    VAPID_PRIVATE_KEY="$(bun -e 'console.log(require("web-push").generateVAPIDKeys().privateKey)')" \
    bun run build
RUN bun build src/cli/index.ts --target=bun --conditions=react-server --external=pg-native --outfile=dist/cli.js
RUN bun build src/api/server.ts --target=bun --conditions=react-server --external=pg-native --outfile=dist/api.js

FROM oven/bun:${BUN_VERSION}-slim AS release
WORKDIR /app
ENV NODE_ENV=production \
    ENVIRONMENT=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/dist/cli.js ./cli.js
COPY --from=build /app/dist/api.js ./api.js
USER bun
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["bun", "-e", "const r = await fetch('http://127.0.0.1:3000/api/auth/ok'); process.exit(r.ok ? 0 : 1)"]
CMD ["bun", "server.js"]

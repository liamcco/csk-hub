#!/usr/bin/env bash
# Run the whole Hub stack locally from this checkout, as deploy/compose.yml deploys it:
# PostgreSQL, Redis, migrate, the standalone API, the web server and the proxy, at
# https://localhost:8443 (APP_PORT).
#
#   deploy/local-stack.sh up        build the image from the working tree and start the stack
#   deploy/local-stack.sh validate  check routing, Better Auth, Member ID, a protected read and
#                                   write and real-time delivery through the proxy against the
#                                   running stack (restarts api and redis on the way)
#   deploy/local-stack.sh reset     stop the stack and delete its data (database, Redis, Caddy CA)
#   deploy/local-stack.sh down      stop the stack and keep its data
#   deploy/local-stack.sh logs      follow every service's logs
#
# The first `up` writes deploy/local.env with fresh secrets and VAPID keys (never committed).
# EMAIL_MODE=log prints email, including invitation links, to the api and web logs.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
env_file="${STACK_ENV:-$here/local.env}"
image="${CSK_HUB_IMAGE:-csk-hub:local}"

compose() {
  CSK_HUB_IMAGE="$image" docker compose \
    --project-name "${COMPOSE_PROJECT_NAME:-csk-hub-local}" \
    --file "$here/compose.yml" \
    --env-file "$env_file" \
    "$@"
}

write_env() {
  [[ -f "$env_file" ]] && return
  local keys
  keys="$(cd "$root" && bun -e 'const k = require("web-push").generateVAPIDKeys(); console.log(`${k.publicKey} ${k.privateKey}`)')"
  cat >"$env_file" <<EOF
# Written by deploy/local-stack.sh for the local stack only. Delete it to start over with new secrets.
APP_PORT=8443
SITE_ADDRESS=https://localhost:8443
BETTER_AUTH_URL=https://localhost:8443
POSTGRES_PASSWORD=$(openssl rand -hex 16)
POSTGRES_APP_PASSWORD=$(openssl rand -hex 16)
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
EMAIL_MODE=log
VAPID_PUBLIC_KEY=${keys% *}
VAPID_PRIVATE_KEY=${keys#* }
EOF
  echo "Wrote $env_file."
}

case "${1:-}" in
  up)
    write_env
    vapid_public_key="$(sed -n 's/^VAPID_PUBLIC_KEY=//p' "$env_file")"
    docker build --file "$here/Dockerfile" --tag "$image" \
      --build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY="$vapid_public_key" "$root"
    compose up --detach --wait
    echo "The Hub is running at $(sed -n 's/^BETTER_AUTH_URL=//p' "$env_file")."
    ;;
  validate)
    [[ -f "$env_file" ]] || { echo "✖ No $env_file: run '$0 up' first." >&2; exit 1; }
    COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-csk-hub-local}" STACK_ENV="$env_file" CSK_HUB_IMAGE="$image" \
      bun "$here/validate-stack.ts"
    ;;
  reset)
    [[ -f "$env_file" ]] || { echo "Nothing to reset."; exit 0; }
    compose down --volumes --remove-orphans
    ;;
  down)
    [[ -f "$env_file" ]] || exit 0
    compose down
    ;;
  logs)
    compose logs --follow
    ;;
  *)
    awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0" >&2
    exit 1
    ;;
esac

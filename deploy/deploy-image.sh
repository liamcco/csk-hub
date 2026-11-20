#!/usr/bin/env bash
# Deploy one published CSK Hub image, preferably pinned by digest.
#
#   deploy/deploy-image.sh ghcr.io/herr-ek/csk-hub@sha256:...
#
# The stack's own ordering does the rest: `migrate` applies pending migrations with the new image
# and `app` starts only after it succeeds.
#
# Targets (DEPLOY_TARGET):
#   portainer (default)  POST the stack's Portainer webhook with CSK_HUB_IMAGE set to the image.
#                        PORTAINER_WEBHOOK_URL is a deployment credential: keep it out of the
#                        repository and configure it separately from registry access.
#   compose              `docker compose up` on this machine, from deploy/compose.yml and
#                        STACK_ENV (default deploy/stack.env), as project COMPOSE_PROJECT_NAME
#                        (default csk-hub-stack). For trying a release locally.
set -euo pipefail

image="${1:-}"
if [[ -z "$image" || "$image" == -* ]]; then
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0" >&2
  exit 1
fi

here="$(cd "$(dirname "$0")" && pwd)"

case "${DEPLOY_TARGET:-portainer}" in
  portainer)
    if [[ -z "${PORTAINER_WEBHOOK_URL:-}" ]]; then
      echo "✖ PORTAINER_WEBHOOK_URL is not set. Without it, select ${image} in Portainer by hand." >&2
      exit 1
    fi
    encoded="$(bun -e 'console.log(encodeURIComponent(process.argv[1]))' "$image")"
    separator="?"
    [[ "$PORTAINER_WEBHOOK_URL" == *"?"* ]] && separator="&"
    curl --fail-with-body --silent --show-error --request POST \
      "${PORTAINER_WEBHOOK_URL}${separator}CSK_HUB_IMAGE=${encoded}"
    echo "Asked Portainer to redeploy the stack with ${image}."
    ;;
  compose)
    CSK_HUB_IMAGE="$image" docker compose \
      --project-name "${COMPOSE_PROJECT_NAME:-csk-hub-stack}" \
      --file "$here/compose.yml" \
      --env-file "${STACK_ENV:-$here/stack.env}" \
      up --detach --wait
    echo "Deployed ${image} with Docker Compose."
    ;;
  *)
    echo "✖ Unknown DEPLOY_TARGET: ${DEPLOY_TARGET}. Expected portainer or compose." >&2
    exit 1
    ;;
esac

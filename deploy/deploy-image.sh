#!/usr/bin/env bash
# Deploy one published pair of CSK Hub images, preferably pinned by digest.
#
#   deploy/deploy-image.sh ghcr.io/herr-ek/csk-hub-api@sha256:... ghcr.io/herr-ek/csk-hub-web@sha256:...
#
# The stack's own ordering does the rest: `migrate` applies pending migrations with the new API
# image, `api` starts only after it succeeds and `web` once the API is healthy.
#
# Targets (DEPLOY_TARGET):
#   portainer (default)  POST the stack's Portainer webhook with CSK_HUB_API_IMAGE and
#                        CSK_HUB_WEB_IMAGE set to the images.
#                        PORTAINER_WEBHOOK_URL is a deployment credential: keep it out of the
#                        repository and configure it separately from registry access.
#   compose              `docker compose up` on this machine, from deploy/compose.yml and
#                        STACK_ENV (default deploy/stack.env), as project COMPOSE_PROJECT_NAME
#                        (default csk-hub-stack). For trying a release locally.
set -euo pipefail

api_image="${1:-}"
web_image="${2:-}"
if [[ -z "$api_image" || "$api_image" == -* || -z "$web_image" ]]; then
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0" >&2
  exit 1
fi

here="$(cd "$(dirname "$0")" && pwd)"

case "${DEPLOY_TARGET:-portainer}" in
  portainer)
    if [[ -z "${PORTAINER_WEBHOOK_URL:-}" ]]; then
      echo "✖ PORTAINER_WEBHOOK_URL is not set. Without it, select the images in Portainer by hand." >&2
      exit 1
    fi
    query="$(bun -e 'console.log(new URLSearchParams({ CSK_HUB_API_IMAGE: process.argv[1], CSK_HUB_WEB_IMAGE: process.argv[2] }).toString())' "$api_image" "$web_image")"
    separator="?"
    [[ "$PORTAINER_WEBHOOK_URL" == *"?"* ]] && separator="&"
    curl --fail-with-body --silent --show-error --request POST \
      "${PORTAINER_WEBHOOK_URL}${separator}${query}"
    echo "Asked Portainer to redeploy the stack with ${api_image} and ${web_image}."
    ;;
  compose)
    CSK_HUB_API_IMAGE="$api_image" CSK_HUB_WEB_IMAGE="$web_image" docker compose \
      --project-name "${COMPOSE_PROJECT_NAME:-csk-hub-stack}" \
      --file "$here/compose.yml" \
      --env-file "${STACK_ENV:-$here/stack.env}" \
      up --detach --wait
    echo "Deployed ${api_image} and ${web_image} with Docker Compose."
    ;;
  *)
    echo "✖ Unknown DEPLOY_TARGET: ${DEPLOY_TARGET}. Expected portainer or compose." >&2
    exit 1
    ;;
esac

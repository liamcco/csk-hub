#!/usr/bin/env bash
# Build and publish the CSK Hub release images (API and web) from a clean checkout of one commit.
#
#   deploy/publish-image.sh --ref origin/master            build, check, push; print tag and digest
#   deploy/publish-image.sh --ref origin/master --deploy   ...then deploy that exact image
#   deploy/publish-image.sh --ref HEAD --no-push           build and check only, into the local Docker
#
# Runs the same from a laptop as from automation. Pushing uses Docker's existing login to the
# registry (`docker login ghcr.io`); deploying uses deploy/deploy-image.sh and its own credentials.
#
# Environment:
#   IMAGE                          repository prefix (default ghcr.io/herr-ek/csk-hub); the images
#                                  are published as ${IMAGE}-api and ${IMAGE}-web
#   PLATFORM                       target platform (default linux/amd64; confirm GUD's CPU at rollout)
#   VITE_VAPID_PUBLIC_KEY          required; inlined into the browser bundle, so it must match the
#                                  stack's VAPID_PUBLIC_KEY
#   ENV_FILE                       environment for the tests (default .env in this checkout)
#   SKIP_CHECKS=1                  skip lint, typecheck and tests (emergencies only)
set -euo pipefail

usage() {
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
}

ref=""
deploy=false
push=true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) ref="${2:-}"; shift 2 ;;
    --ref=*) ref="${1#--ref=}"; shift ;;
    --deploy) deploy=true; shift ;;
    --no-push) push=false; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "✖ Unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done

if [[ -z "$ref" ]]; then
  echo "✖ --ref is required, e.g. --ref origin/master." >&2
  exit 1
fi
if [[ -z "${VITE_VAPID_PUBLIC_KEY:-}" ]]; then
  echo "✖ VITE_VAPID_PUBLIC_KEY is required: the browser bundle needs the stack's VAPID_PUBLIC_KEY." >&2
  exit 1
fi
if [[ "$deploy" == true && "$push" == false ]]; then
  echo "✖ --deploy needs a published image; it cannot be combined with --no-push." >&2
  exit 1
fi

IMAGE="${IMAGE:-ghcr.io/herr-ek/csk-hub}"
PLATFORM="${PLATFORM:-linux/amd64}"
repository="$(git rev-parse --show-toplevel)"
commit="$(git -C "$repository" rev-parse --verify "${ref}^{commit}")"
short="${commit:0:12}"

# A clean checkout of exactly that commit: nothing uncommitted or untracked reaches the image.
checkout="$(mktemp -d "${TMPDIR:-/tmp}/csk-hub-release.XXXXXX")"
cleanup() {
  git -C "$repository" worktree remove --force "$checkout" >/dev/null 2>&1 || rm -rf "$checkout"
}
trap cleanup EXIT
git -C "$repository" worktree add --detach --quiet "$checkout" "$commit"
echo "Building ${short} (${ref}) for ${PLATFORM} from a clean checkout."

if [[ "${SKIP_CHECKS:-}" != 1 ]]; then
  # The tests read the same untracked .env a developer uses; the image never contains it.
  env_file="${ENV_FILE:-$repository/.env}"
  if [[ -f "$env_file" ]]; then cp "$env_file" "$checkout/.env"; fi
  (
    cd "$checkout"
    bun install --frozen-lockfile
    bun run lint
    bun run typecheck
    bun run tst
  )
else
  echo "⚠  SKIP_CHECKS=1: publishing without lint, typecheck and tests." >&2
fi

# Builds one target (api or web); pushes it unless --no-push, and prints its pinned reference.
publish() {
  local target="$1" repository_name="${IMAGE}-$1"
  local tag="${repository_name}:sha-${short}"
  local args=(
    --file "$checkout/deploy/Dockerfile"
    --target "$target"
    --platform "$PLATFORM"
    --label "org.opencontainers.image.revision=${commit}"
    --label "org.opencontainers.image.source=https://github.com/herr-ek/csk-hub"
    --tag "$tag"
  )
  [[ "$target" == web ]] && args+=(--build-arg "VITE_VAPID_PUBLIC_KEY=${VITE_VAPID_PUBLIC_KEY}")
  if [[ "$push" == false ]]; then
    docker buildx build "${args[@]}" --load "$checkout" >&2
    echo "$tag"
    return
  fi
  local metadata="$checkout/.image-metadata-${target}.json"
  docker buildx build "${args[@]}" --push --metadata-file "$metadata" "$checkout" >&2
  local digest
  digest="$(bun -e "console.log((await Bun.file(process.argv[1]).json())['containerimage.digest'])" "$metadata")"
  echo "${repository_name}@${digest}"
}

api_reference="$(publish api)"
web_reference="$(publish web)"

if [[ "$push" == false ]]; then
  echo "Built ${api_reference} and ${web_reference} locally (not pushed)."
  exit 0
fi

echo "Published:"
echo "  api: ${api_reference}"
echo "  web: ${web_reference}"

if [[ "$deploy" == true ]]; then
  "$repository/deploy/deploy-image.sh" "$api_reference" "$web_reference"
fi

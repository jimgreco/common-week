#!/usr/bin/env bash
# Invoke only after backup/restore and migration staging review, with the
# coordinator's existing pinned SSH connection. No credentials are transferred.
set -euo pipefail

release_build="${1:-}"
expected_live_build="${2:-}"
[[ "$release_build" =~ ^[0-9a-f]{40}$ ]] || { echo 'Exact release SHA required.'; exit 1; }
[[ "$expected_live_build" =~ ^[0-9a-f]{40}$ ]] || { echo 'Exact expected live SHA required.'; exit 1; }
[ "${3:-}" = --recovery-reviewed ] || { echo 'Verified backup restore and migration staging review must be acknowledged.'; exit 1; }
release_image="ghcr.io/jimgreco/common-week:$release_build"

# All shared-host app coordinators must use this same lock.
exec 9>"$HOME/deploy/.app-release.lock"
flock -n 9 || { echo 'Another app release holds the shared-host lock.'; exit 1; }
running=()
while IFS= read -r container_id; do
  [ -n "$container_id" ] && running+=("$container_id")
done < <(docker ps -q --filter label=com.docker.compose.project=deploy --filter label=com.docker.compose.service=common-week)
[ "${#running[@]}" -eq 1 ] || { echo 'Expected exactly one running Week of Us container.'; exit 1; }
container="${running[0]}"
inspect() { docker inspect --format "$1" "$container"; }
previous_image="$(inspect '{{.Config.Image}}')"
previous_image_id="$(inspect '{{.Image}}')"
previous_hash="$(inspect '{{index .Config.Labels "com.docker.compose.config-hash"}}')"
project="$(inspect '{{index .Config.Labels "com.docker.compose.project"}}')"
working_directory="$(inspect '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')"
config_files="$(inspect '{{index .Config.Labels "com.docker.compose.project.config_files"}}')"
previous_build="$(inspect '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^APP_BUILD=//p')"
previous_url="$(inspect '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^NEXT_PUBLIC_APP_URL=//p')"
[ "$project" = deploy ] && [ "$working_directory" = "$HOME/deploy" ] || { echo 'Unexpected Compose project.'; exit 1; }
[ "$previous_image" = "ghcr.io/jimgreco/common-week:$expected_live_build" ] && [ "$previous_build" = "$expected_live_build" ] || { echo 'Live commit changed; reconcile before deploying.'; exit 1; }
[ "$previous_url" = https://weekofus.com ] || { echo 'Unexpected live application origin.'; exit 1; }
[[ "$previous_hash" =~ ^[0-9a-f]+$ ]] || { echo 'Missing live Compose configuration hash.'; exit 1; }

cd "$working_directory"
compose_args=(-p "$project")
IFS=',' read -r -a recorded_files <<< "$config_files"
[ "${#recorded_files[@]}" -ge 1 ] || { echo 'Missing recorded Compose files.'; exit 1; }
for config in "${recorded_files[@]}"; do
  [ -f "$config" ] || { echo 'A recorded Compose file is missing.'; exit 1; }
  compose_args+=(-f "$config")
done
compose() { docker-compose "${compose_args[@]}" "$@"; }
export COMPOSE_PROFILES=common-week
export COMMON_WEEK_IMAGE="$previous_image" COMMON_WEEK_APP_BUILD="$previous_build" COMMON_WEEK_APP_URL="$previous_url"
reconstructed_hash="$(compose config --hash common-week | awk '$1 == "common-week" {print $2}')"
[ "$reconstructed_hash" = "$previous_hash" ] || { echo 'Compose differs from effective live configuration; reconcile without releasing.'; exit 1; }

# Keep the existing image even if its registry tag changes elsewhere. This is
# forensic/recovery retention, not permission to run a pre-020 binary afterward.
docker image tag "$previous_image_id" "common-week-retained:$expected_live_build"
export COMMON_WEEK_IMAGE="$release_image" COMMON_WEEK_APP_BUILD="$release_build"
# Existing server registry authorization only. Never copy a runner's auth file.
compose pull common-week
compose config --hash common-week >/dev/null

# Notification scheduling is embedded in this one application process. Stop it
# before migration020; neither old APIs nor old workers may run on that schema.
[ "$(compose ps -q common-week)" = "$container" ] || { echo 'Live container changed during preflight.'; exit 1; }
compose stop -t 60 common-week
cutover_started=true
cutover_complete=false
# shellcheck disable=SC2329 # invoked by the EXIT trap
cleanup() {
  if [ "$cutover_started" = true ] && [ "$cutover_complete" != true ]; then
    compose stop -t 60 common-week || true
    echo 'Cutover failed. Week of Us is stopped; retain schema/data and deploy a compatible corrected build (88c34e7 or later).'
  fi
}
trap cleanup EXIT
compose run --rm --no-deps -T common-week node scripts/migrate.mjs </dev/null
compose up -d --force-recreate --no-deps --no-build common-week
container="$(compose ps -q common-week)"
[ "$(inspect '{{.Config.Image}}')" = "$release_image" ] || { echo 'Unexpected deployed image.'; exit 1; }
for attempt in $(seq 1 60); do
  if compose exec -T common-week node -e '
    fetch("http://127.0.0.1:3000/api/health")
      .then(async (response) => {
        const body = await response.json();
        process.exit(response.ok && body.status === "ok" && body.database === "ready" && body.build === process.env.APP_BUILD ? 0 : 1);
      }).catch(() => process.exit(1));' </dev/null; then
    cutover_complete=true
    echo "Week of Us is healthy at build $release_build; previous image retained."
    exit 0
  fi
  [ "$attempt" -eq 60 ] || sleep 2
done
echo 'Week of Us failed its exact-build database health check.'
exit 1

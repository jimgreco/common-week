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
container="$(docker inspect --format '{{.Id}}' "${running[0]}")"
[[ "$container" =~ ^[0-9a-f]{64}$ ]] || { echo 'Could not resolve full live container identity.'; exit 1; }
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
[[ "$previous_hash" =~ ^[0-9a-f]{64}$ ]] || { echo 'Missing live Compose configuration hash.'; exit 1; }

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
if [ "$reconstructed_hash" != "$previous_hash" ]; then
  # Compose 2.26.1 removes external dependencies before hashing an up --no-deps
  # service. Require a lossless full-model roundtrip before that sole exception.
  # Resolved configuration stays in memory/stdin, never in arguments or files.
  python3 - "$previous_hash" "$reconstructed_hash" "$container" "$project" "$working_directory" "${compose_args[@]}" <<'PYHASH'
import copy
import json
import re
import subprocess
import sys

previous, original, container, project, directory, *compose_args = sys.argv[1:]

def run(arguments, model=None):
    result = subprocess.run(arguments, input=None if model is None else json.dumps(model),
                            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise ValueError("configuration command failed")
    return result.stdout.strip()

def service_hash(arguments, model):
    fields = run(arguments + ["config", "--hash", "common-week"], model).split()
    if len(fields) != 2 or fields[0] != "common-week" or not re.fullmatch(r"[0-9a-f]{64}", fields[1]):
        raise ValueError("invalid service hash")
    return fields[1]

try:
    labels = json.loads(run(["docker", "inspect", "--format", "{{json .Config.Labels}}", container]))
    if labels.get("com.docker.compose.depends_on") != "" or labels.get("com.docker.compose.version") != "2.26.1":
        raise ValueError("not an identified no-deps container")
    if run(["docker-compose", "version", "--short"]) != "2.26.1":
        raise ValueError("unverified Compose version")
    model = json.loads(run(["docker-compose", *compose_args, "config", "--format", "json"]))
    dependencies = model["services"]["common-week"].get("depends_on")
    if not isinstance(dependencies, dict) or not dependencies or "common-week" in dependencies:
        raise ValueError("no external dependencies to normalize")
    roundtrip = ["docker-compose", "-p", project, "--project-directory", directory, "-f", "-"]
    if service_hash(roundtrip, model) != original:
        raise ValueError("full-model roundtrip changed the configuration")
    scoped = copy.deepcopy(model)
    del scoped["services"]["common-week"]["depends_on"]
    if service_hash(roundtrip, scoped) != previous:
        raise ValueError("unmatched configuration after dependency normalization")
except (ValueError, KeyError, TypeError, OSError):
    sys.exit("Compose differs from effective live configuration; reconcile without releasing.")
PYHASH
fi

# Keep the existing image even if its registry tag changes elsewhere. This is
# forensic/recovery retention, not permission to run a pre-020 binary afterward.
docker image tag "$previous_image_id" "common-week-retained:$expected_live_build"
export COMMON_WEEK_IMAGE="$release_image" COMMON_WEEK_APP_BUILD="$release_build"
# Existing server registry authorization only. Never copy a runner's auth file.
compose pull common-week
compose config --hash common-week >/dev/null

# Notification scheduling is embedded in this one application process. Stop it
# before migration020; neither old APIs nor old workers may run on that schema.
current_container="$(compose ps -q common-week)"
[ "$(docker inspect --format '{{.Id}}' "$current_container")" = "$container" ] || { echo 'Live container changed during preflight.'; exit 1; }
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

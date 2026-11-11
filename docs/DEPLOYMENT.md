# Deployment

## Consolidated EC2 server

**Release** (`.github/workflows/release.yml`, the standard release-tools template) runs `.github/workflows/verify.yml` (web, database, offline-recovery, family and browser smoke tests, plus the iOS simulator and Mac Catalyst tests) on pull requests and on pushes to `main`. On a push to `main` it then calls the shared server release workflow from [`jimgreco/release-tools`](https://github.com/jimgreco/release-tools) pinned by commit, and uploads to TestFlight. A manual run on `main` releases what its `server` and `ios` checkboxes select. The server procedure is documented in [release-tools `server/README.md`](https://github.com/jimgreco/release-tools/blob/ff61f1c6a6eb51ea982246473203bcc903ce8153/server/README.md); this app's settings are in `.github/release/server.json`. A server release publishes `ghcr.io/jimgreco/common-week:<sha>` (ARM64, `APP_BUILD=<sha>`) and releases it.

A release reads the live build from `https://weekofus.com/api/health` and refuses unless it is an ancestor of the commit being released, so a re-run of an older push or a hotfix from another branch is never overwritten. On the host it takes the shared-host release locks, reconstructs the live Compose invocation (profile `common-week`, with `COMMON_WEEK_IMAGE`, `COMMON_WEEK_APP_BUILD` and `COMMON_WEEK_APP_URL` taken from the running container) and refuses on any configuration drift. It then changes only the image and `APP_BUILD` of `common-week`, through a `~/deploy/releases/common-week-image-<sha>.json` override, in this order:

1. Pull the image with the host's existing registry login and tag the previous image `common-week-rollback:<time>-<container>`.
2. Back up only the `common_week` database (`pg_dump -Fc` inside `shared_db`), check it is readable and contains `planning_items`, and keep the 20 newest in `~/deploy/backups/common-week/`. If the backup fails, nothing has changed.
3. Run `scripts/check-offline-recovery-role.mjs --before-migration` from the new image while the current build still serves.
4. Stop Week of Us (and its embedded notification scheduler), run `scripts/migrate.mjs` and `scripts/check-offline-recovery-role.mjs --require-compatible` from the new image, and recreate only `common-week` with `--no-deps --no-build`.
5. Require `/api/health` inside the container to report `status: ok`, `database: ready` and the exact build. After that, the shared release workflow checks the same on the public URL.

Once migrations have started, any failure leaves Week of Us stopped for a compatible corrected build; there is no automatic rollback to a pre-migration binary. `88c34e7` is the minimum compatible rollback revision; never restart pre-audit workers after migration 020. Keep migration 021 during recovery, since reverting the old Google linking flow reintroduces the vulnerability. A readable backup is not a tested restore: for releases with risky migrations, still rehearse against a staging copy first.

The release never transfers credentials or edits `.env`, shared Compose files, database roles/grants or ownership. The role checks are read-only; a mismatch stops the release. See [exact role requirements](OFFLINE-DRAFT-RECOVERY.md#database-role-release-gate-october-7-follow-up). The live Compose chain includes this app's `common-week-apple.yml` layer (reference copy in `.github/deploy/`); keep it, and the existing Google/Apple, email/APNs, database and encryption configuration, intact. Any change to those is its own reviewed step outside a release.

The host release needs the secrets `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY` and the pinned `EC2_SSH_KNOWN_HOSTS`, the same names as every other app. The older `EC2_KNOWN_HOSTS` secret is no longer used and can be deleted.

Native distribution is the `ios` job of the same workflow (`.github/workflows/testflight.yml`): it uploads iOS and Mac Catalyst builds on pushes to `main`, or on a manual run with `ios` selected (see [native-testflight-existing-assets.md](native-testflight-existing-assets.md)). Old clients keep ordinary sign-in but cannot finish new Calendar linking until updated. Older ambiguous offline drafts remain quarantined; never automatically reassign or delete them.

## Weekly summary endpoint

`GET /api/weekly-summary?week=<Monday>` is a read-only summary for the separate weekly-review routine (contract: weekly-review `docs/weekly-summary-contract.md`). It returns 404 unless both optional variables below are set, so shipping the code is inert.

| Variable | Meaning |
|---|---|
| `WEEKLY_SUMMARY_TOKEN_SHA256` | Lowercase hex SHA-256 of the routine's bearer token. The plaintext token is never stored in the app. |
| `WEEKLY_SUMMARY_EMAIL` | The account whose household is reported (case-insensitive). The token cannot choose another user. |

- The route accepts only this token. It never reads user session cookies or bearer tokens, and this token is accepted nowhere else. A missing, wrong, or session token is a 404; demo mode is a 404.
- It runs plain `SELECT`s only: no task carry-over, routine materialization, Google calls, or session/audit writes.
- Generate the token with `TOKEN=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-40)` and the hash with `printf %s "$TOKEN" | shasum -a 256 | cut -d' ' -f1`. Store `$TOKEN` only in the routine's environment.
- Releases do not transfer environment values. To enable it, the owner adds both variables to the `common-week` service's environment in the live host Compose layer (the reference copy is `.github/deploy/common-week-apple.yml`, where they are optional with empty defaults) and recreates only that service. Because this changes the recorded Compose configuration, do it as its own step outside a release, then confirm `/api/health` and the configuration guard on the next deploy.
- Verify with `curl -fsS -H "Authorization: Bearer $TOKEN" "https://weekofus.com/api/weekly-summary?week=<Monday>"`: expect `200`, `Cache-Control: no-store`, and `"app":"planner"`. Without the header, expect `404`.

## Vercel note

The application remains build-compatible with Vercel, but the chosen production database is private on the consolidated EC2 Compose network. A Vercel deployment would need secure network access to that database or a separate managed PostgreSQL instance. The canonical deployment path is therefore the existing EC2 server.

## Post-deploy verification

- The workflow already confirms `/api/health` reports `status: ok`, the deployed commit, and `database: ready`.
- Confirm `/` offers Google sign-in after credentials are configured.
- Complete the two-member and third-account isolation checks in [SETUP.md](SETUP.md).
- Inspect response headers for CSP, frame denial, MIME-sniffing prevention, referrer policy, and permissions policy.
- Confirm database and Google secrets are absent from browser JavaScript.
- Test `/planner` at 1440px, 390px, and 320px widths.
- Confirm Calendar or weather interruption does not prevent planning-item use.

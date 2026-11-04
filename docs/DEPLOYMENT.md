# Deployment

## Consolidated EC2 server

Every push to `main` validates the code, publishes the exact-commit ARM64 image, and then deploys it automatically. The deploy job reads the live build from `https://weekofus.com/api/health`, does nothing if that is already the pushed commit, and refuses to deploy unless the live build is an ancestor of the pushed commit, so a re-run of an older push or a hotfix from another branch is never overwritten. Deploys are serialized by the `deploy-common-week` concurrency group and the shared-host lock; Week of Us is still released alone, without moving a `latest` tag or removing images. Native builds upload from CI, not from this workflow.

Before a Week of Us cutover, review a recoverable backup and successful restore test, rehearse migrations 020–021 against a staging copy, record expected quarantine counts, and confirm the exact current live SHA. Migration 020 preserves historical data but requires the new authorization and notification worker code. `88c34e7` is the minimum compatible rollback revision; never restart pre-audit workers after migration 020. Keep migration 021 during recovery, since reverting the old Google linking flow reintroduces the vulnerability.

Every cutover first takes a logical backup of only the `common_week` database with `pg_dump -Fc` inside the existing `shared_db` container, after checking there is room for it, and proves it is readable with `pg_restore --list`. Backups are kept on the host in `~/deploy/backups/common-week/` (the 20 newest; nothing else there is removed). If the backup cannot be taken or read, the release stops while the current build keeps serving. A readable archive is not a tested restore: for releases with risky migrations, still rehearse against a staging copy before pushing. The workflow passes `--automatic-backup`; a coordinator can run `.github/scripts/deploy-app.sh` over the existing pinned SSH connection with the new SHA, expected current SHA, and `--recovery-reviewed` after a manual review, and the script takes the same backup. All app release coordinators must share `~/deploy/.app-release.lock`.

The script reconstructs the running container's exact recorded Compose project/files and compares its configuration hash with the live hash before changing anything. It changes only the image/build, uses existing host registry access, retains the old image under `common-week-retained:<sha>`, stops Week of Us and its embedded notification scheduler, runs migrations from the new image, and recreates only `common-week` with `--no-deps`. It neither transfers credentials nor edits shared environment files, database roles/grants, network settings, or dependencies. Container identity checks normalize Docker and Compose IDs to full IDs. The configuration guard accepts the exact normal hash, or for identified Compose 2.26.1 containers created with `--no-deps`, requires an exact full-model roundtrip before comparing a copy with only `common-week` external dependencies removed. It retains every other hashed field, keeps resolved values in memory/stdin, and rejects unknown versions, missing dependency labels, lossy roundtrips, or other configuration drift. Configuration drift, unavailable registry access, a changed live SHA, or missing Compose files fail before cutover. Once cutover starts, failure leaves Week of Us stopped for a compatible corrected build; there is no automatic pre-audit rollback.

A manually dispatched **Deploy to EC2** run with `deploy: true` redeploys a `main` commit the same way; `expected_live_build` is optional and, when given, must match the live build. It requires existing `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY`, and pinned `EC2_KNOWN_HOSTS` configuration. If pinned host trust is absent, it stops before writing runner SSH files: use the coordinator's existing pinned local SSH connection. Adding trust settings requires its own approval. Pushes to `main` use the same host job and requirements.

The recovery release also verifies database roles through read-only catalog checks: before stopping the app, the configured dedicated non-superuser login must own its database and prerequisite tables; after migration 022, it must directly own `offline_draft_recoveries`, with non-FORCE RLS and no policies. The deployment checks this using the same service connection used for migrations and runtime. A mismatch stops release without granting permissions or changing ownership. See [exact role requirements and rehearsal evidence](OFFLINE-DRAFT-RECOVERY.md#database-role-release-gate-october-7-follow-up).

Existing Google/Apple, email/APNs, database and encryption configuration must remain intact. Missing or mismatched values require separate reconciliation; the application release no longer generates keys, rewrites provider credentials, creates roles/databases, or changes ownership. Ensure later infrastructure deployments retain this exact app image/build pin and effective Compose layers rather than restoring an older binary.

After local invocation, independently check the canonical `https://weekofus.com/api/health` for the exact SHA, `status: ok`, and `database: ready`. The script's container health check alone does not prove public proxy routing. Verify login/sync using authorized test accounts; do not trigger real provider consent or email/push sends merely for QA.

Native distribution is separate: dispatch **CI** on the same `main` SHA with `upload_native: true` after its upload is authorized. iOS test failures now fail CI. The signing helper only inspects/downloads existing approved Apple Developer assets and fails if bundles, capabilities or profiles are missing; it cannot create them. Confirm uploader acceptance and App Store Connect processing separately from device installation. Old clients retain ordinary sign-in but cannot finish new Calendar linking until updated. Older ambiguous offline drafts remain quarantined; never automatically reassign or delete them.

## Vercel note

The application remains build-compatible with Vercel, but the chosen production database is private on the consolidated EC2 Compose network. A Vercel deployment would need secure network access to that database or a separate managed PostgreSQL instance. The canonical deployment path is therefore the existing EC2 server.

## Post-deploy verification

- Confirm `/api/health` reports `status: ok`, the deployed commit, and `database: ready`.
- Confirm `/` offers Google sign-in after credentials are configured.
- Complete the two-member and third-account isolation checks in [SETUP.md](SETUP.md).
- Inspect response headers for CSP, frame denial, MIME-sniffing prevention, referrer policy, and permissions policy.
- Confirm database and Google secrets are absent from browser JavaScript.
- Test `/planner` at 1440px, 390px, and 320px widths.
- Confirm Calendar or weather interruption does not prevent planning-item use.

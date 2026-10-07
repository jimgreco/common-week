# Retained offline draft review and recovery

Prepared locally on 2026-10-07, based on `a66fdb9`. Historical user data was not accessed or changed. A later release-gate check read production catalog metadata only. Existing Mac checkout edits remain untouched. This feature does not infer a legacy draft's household.

## User flow

On iPhone or Mac, open **Settings → Saved offline drafts**. Enter the original account email and household ID shown for the signed-in household, then explicitly confirm the original identity. An online session check must match both IDs before files or draft contents appear. If the original household is unknown or inaccessible, leave the source files preserved; do not guess or reassign them.

Each original file can be exported through the system file exporter, preserving all bytes (including damaged JSON). A SHA-256 fingerprint is displayed. Export may contain multiple drafts/households; the user chooses its destination. Cancellation, navigation away, backgrounding or an account change locks review and clears in-memory export contents. A file changed since review must be opened and verified again. Duplicate mutation IDs make that file export-only.

Confirm the original household separately for each draft, then check for conflicts. Older creates and edits with stable item IDs can be compared with the current household item. Existing items are displayed for comparison, never overwritten. An item ID match is only a conflict check and is explicitly not evidence of the legacy draft’s household ownership. Old edits, completion/deletion changes and location changes have no reliable base revision; these are review/export-only, with deliberate current-planner edits available through the ordinary app. Attributed v2 queues continue their existing scoped replay and are never re-attributed by recovery.

Only an unattributed **create** with its original item UUID can be recovered. The final confirmation shares its original text/type/date with the verified household as an unassigned item. It does not restore assignments, child tags, ordering anchors, reminders, or provider notification work. All original metadata remains in the source/export. A missing/invalid ID, malformed date, or oversized text requires manual review. No source file is modified, moved, deleted or silently marked recovered.

## Server boundary and retries

`POST /api/ios/offline-recovery` requires a native bearer, matching original user/household fields and both scope headers. Bodies are bounded to 16 KiB and only the narrow review/recover schema is accepted. The transaction rechecks the current session and household membership under row locks; recovery rejects viewers. A household lock serializes creates and duplicate attempts. Inserts use the original item UUID with `ON CONFLICT DO NOTHING`. Other households' item contents are never returned.

Migration **022_offline_draft_recovery.sql** adds only an initially empty receipt table, with RLS enabled. A receipt binds the user/mutation, household, source digest, reviewed draft digest and item UUID in the same transaction as creation. Receipts survive ordinary item deletion, so delayed retries cannot resurrect a recovered item. Changed contents or destination produce a conflict. Existing account/household deletion remains governed by its existing explicit lifecycle; this migration performs no historical cleanup. No notification/reminder rows or external provider work are created by recovery.

If a response is lost, the app requires review again and queries the same receipt. It never automatically retries or puts recovery into the normal offline queue. Closing a screen stops further work and ignores stale responses; a request already submitted may have completed on the server, so a later review checks its receipt rather than assuming cancellation undid a write.

## Release order and owner acceptance

1. Parent coordinates an exact release SHA and the shared-host lock/slot. Review a current recoverable backup/restore result and rehearse additive migration 022 against staging. Retain shipped migrations 020–021 and all privacy filters; the historical rollback floor remains `88c34e7`.
2. Publish and deploy the matching server with 022 through the existing guarded workflow, then verify exact-SHA health and database readiness. There is no automatic database rollback or recovery of user drafts.
3. Release the same native source. Main pushes currently invoke the guarded **iOS-only** TestFlight path; coordinate the main push with server availability so users do not get the recovery UI before its API exists. An older server fails closed with source files preserved.
4. Mac Catalyst code is tested locally, but Mac signing/upload is excluded by the current release policy. Any request to distribute it requires the parent to coordinate the existing approved Mac release path; do not change signing assets, Apple audiences or policy to force an upload.
5. Owner acceptance: on Jim's installed iPhone and signed Mac, verify the household identity display, cancellation/locking, the system export picker and exact exported bytes, offline/reconnect behavior, existing-item comparison and original-file persistence. Use synthetic drafts first. Inspect long text at phone widths and with larger text. Confirm a submitted request with a lost response reports its existing receipt after relaunch.

Real historical recovery remains a separate explicit owner decision for the identified account, original household and reviewed source drafts. No real recovery, provider send, credential/configuration change, production migration, push or deployment was performed here.

## Verification

Local evidence is outside the worktree in its parent task directory (`planner-*.log`, audit JSON and xcresult bundles). The release handoff records final counts. The synthetic HTTP suite covers wrong/partial identity headers, changed bearer accounts, membership changes, viewer rejection, invalid dates/assignments/oversized input, five concurrent retries, changed-source/draft conflicts, preservation of existing and other-household items, post-deletion retry and zero notification/reminder work.

Reproduce against a disposable local `_test` PostgreSQL database only:

```sh
npm ci
npm run db:migrate
npm run test:database
npm run lint
npm run typecheck
npm run test:run -- --maxWorkers=2
CIRCLE_NODE_TOTAL=3 npm run build -- --webpack
npm run test:offline-recovery
SMOKE_PORT=35468 npm run test:smoke
```

`test:offline-recovery` starts a synthetic localhost server on port 3099 after a build, or accepts `OFFLINE_RECOVERY_TEST_BASE_URL` for an already-running isolated server. It requires an explicit localhost `_test` `DATABASE_URL`, creates unique fixtures, and removes only its own fixtures. CI runs it after migrations and build. The browser smoke port is configurable to avoid other lanes.

## Dependency audit

The initial Oct 7 scan reported 11 findings (9 high, 2 moderate). Compatible development/lockfile updates include Vitest 4.1.11, Playwright 1.63.0, React testing/types, Vite React plugin, brace-expansion, js-yaml, undici and source-map-js. Next and eslint-config-next remain paired at 16.3.8; production application dependency versions remain unchanged apart from the source-map-js security patch.

The final scan reports **zero production vulnerabilities** and **five high development findings**, all the same unpatched `braces → micromatch → fast-glob → @next/eslint-plugin-next → eslint-config-next` chain. [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) has no patched braces release as of this scan. Inspection found the Next lint plugin passes configured `settings.next.rootDir` globs into this chain; this repository does not configure that setting. Keep lint inputs/configuration trusted. No audit suppression, override, guard relaxation or forced Next 14 downgrade was applied. Recheck for an upstream compatible patch before release.

The installed npm 10 client crashed resolving optional Vitest peers during updates. A temporary npm 11 client completed the update and clean lockfile install; no global npm installation or repository toolchain downgrade was made.

Local validation for this prepared release:

- `npm ci` succeeds with the host's standard npm 10 as well as the temporary update client.
- Lint, TypeScript, 270 web tests, six PostgreSQL notification tests, database isolation/carryover suite, family/source/task/coverage HTTP suites and native offline-scope HTTP suite pass.
- Production webpack build passes with two Next workers. Recovery HTTP suite passes against both dev and built standalone servers.
- Chromium: all 11 smoke scenarios pass; task attachment preview needed one retry in the first runnable suite. Both attachment scenarios then passed a targeted run with retries disabled. The initial browser launch attempt lacked the newly required Chromium binary; installing it only inside the task directory resolved that prerequisite.
- Full iPhone simulator suite: 122 passed. Full Mac Catalyst suite: 126 passed. Final incremental Catalyst recovery suite: 12 passed, including the later comparison/cancellation refinements.
- Synthetic release guards: 26 passed. Deployment script guards: 15 passed, including role preflight/post-migration failures. Changed workflows pass `actionlint`; `git diff --check` passes.


## Database role release gate (October 7 follow-up)

Read-only inspection through the existing pinned SSH connection verified the live `common-week` container labels and queried only PostgreSQL catalogs with `transaction_read_only=on`. Sanitized evidence: runtime/login role **common_week_app**, effective role setting **none**, superuser **false**, BYPASSRLS **false**, INHERIT **true**, database owner **common_week_app**, public-schema CREATE **true**. The app directly owns `users`, `households`, `household_members`, `auth_sessions`, `planning_items` and `app_schema_migrations`. Migration 022 was not yet present. No production rows, passwords, connection strings or environment values were returned; no production grants or data were changed.

The current release script applies migrations and starts the API with the **same service DATABASE_URL**. Therefore 022 creates its receipt table owned by that dedicated runtime login. PostgreSQL's table-owner exemption from **non-FORCE** RLS is the intended compatibility mechanism; `rolbypassrls` stays false. No allow-all policy, ownership transfer, broad grant, or BYPASSRLS change is required. The shared SQL login does not identify individual app users: the recovery transaction's locked session/membership predicates enforce user/household boundaries, as tested by the HTTP suite. Non-owner SQL roles remain default-denied.

Exact requirements are now enforced in `.github/scripts/deploy-app.sh`:

- Before stopping the service, the new image runs `scripts/check-offline-recovery-role.mjs --before-migration`. The runtime must equal the login role with no SET ROLE override, be non-superuser/non-BYPASSRLS, own the database and the six prerequisite app tables directly, have public-schema CREATE, and have no active RLS restriction on those prerequisite tables. If 022 already exists, it must satisfy the post-migration requirements too. Failure occurs before service stop/migration.
- After migration and before restart, `--require-compatible` requires the receipt table to be directly owned by that same non-superuser login, with RLS enabled, FORCE RLS disabled, no policies, SELECT/INSERT rights and `row_security_active=false` for the owner. If this fails, the existing deployment failure handler leaves Week of Us stopped for compatible correction, retaining data/migrations. It does not attempt a grant or policy repair.
- A future split migration/runtime role setup is **not** implicitly supported. If either check fails, stop release and request a separately reviewed least-privilege design; never grant BYPASSRLS or a blanket policy to make the check pass.

`planner-role-rehearsal.log` records a fresh local database whose login was explicitly NOSUPERUSER, NOBYPASSRLS, NOCREATEDB and NOCREATEROLE, with the database/table ownership matching live. That role successfully applied migrations, passed the pre-022 upgrade and post-022 checks, and ran the full recovery HTTP suite through the production-built server. A separate synthetic role failed without grants; temporary **receipt-table-only SELECT/INSERT** grants still revealed zero receipts and rejected inserts under RLS, and both compatibility gates rejected it. The original owner receipt remained intact. These temporary grants were revoked and all generated databases/roles removed. The existing local test cluster was then stopped.

Reproduce only in a disposable localhost cluster where the administrator can create synthetic roles/databases (the fixture uses local trust authentication for its generated logins):

```sh
ROLE_TEST_ADMIN_DATABASE_URL=postgresql://LOCAL_ADMIN@127.0.0.1:55467/planner_recovery_20261007_test \
  node scripts/test-offline-recovery-roles.mjs
```

This role gate does not authorize the production migration or historical recovery. Parent release coordination and owner acceptance above still apply.

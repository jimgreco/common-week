# Week of Us — coding handoff

Snapshot: **2026-11-02 UTC**. This is a takeover map, not release authorization. Recheck Git status, the requested scope and current runtime before acting. Existing AGENTS.md and linked contract/runbooks remain applicable. Older dated status notes are evidence from their stated date, not current permissions.

## Purpose and architecture

Week of Us provides shared household weekly plans, tasks, calendar views and native widgets.

Next.js/TypeScript web UI with authorized server persistence in PostgreSQL; separate SwiftUI iOS/Mac Catalyst app and widgets. Google/Apple calendar integrations are adapters, not the household source of truth.

## Locations and current work

- Usual local workspace: `/Users/jgreco/code/planner`.
- Source inspected for this handoff: `/Users/jgreco/Documents/Codex/2026-10-25/task/integration-2026-10-30/planner`.
- Existing repository: [jimgreco/common-week](https://github.com/jimgreco/common-week); default branch `main`, verified source head `4ed77828defbff00e452de759c7806cf9f45efd3`.
- Documentation branch: `docs/agent-handoff-2026-11-02`, based on that head; application code was not changed.
- Primary checkout is at `4f002f92bc848f296834caaefcb766cb5862eee8` on `main` and differs from remote main. Do not reset it or assume it contains released features; use the inspected source or a new isolated checkout.

## Code and guide map

- [src/components/planner/weekly-planner.tsx](../src/components/planner/weekly-planner.tsx)
- [src/components/planner/task-workspace.tsx](../src/components/planner/task-workspace.tsx)
- [src/lib/server](../src/lib/server)
- [src/lib/integrations](../src/lib/integrations)
- [db/migrations](../db/migrations)
- [ios/CommonWeek](../ios/CommonWeek)
- [ios/Shared](../ios/Shared)

Read the relevant existing guide before changing its contract:

- [README.md](../README.md)
- [docs/SETUP.md](SETUP.md)
- [docs/DEPLOYMENT.md](DEPLOYMENT.md)
- [docs/ACCEPTANCE.md](ACCEPTANCE.md)
- [docs/OFFLINE-DRAFT-RECOVERY.md](OFFLINE-DRAFT-RECOVERY.md)
- [ios/README.md](../ios/README.md)

## Local setup and dependencies

Commands below are source-verified entry points, **not commands executed during this documentation pass**. Use disposable local data. Read the command comments and linked setup guide before running migrations, creating fixtures or starting listeners. Reuse prepared environments where suitable.

- `npm ci`
- `cp .env.example .env  # choose a local disposable PostgreSQL database`
- `npm run db:migrate`
- `npm run dev`

Configuration names/locations only; never copy secret values into source, terminal output or handoff documents:

- `DATABASE_URL`
- `ENABLE_DEMO`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_TOKEN_ENCRYPTION_KEY`
- `NEXT_PUBLIC_APP_URL`
- `APPLE_SERVICE_ID`
- `RESEND_API_KEY`
- `APNS_KEY_ID`

Use existing lockfiles/manifests; do not upgrade dependencies to perform a handoff. For native work, select an actually installed Xcode SDK/simulator from the checked-in project configuration.

## Tests and verification

- `npm run lint`
- `npm run typecheck`
- `npm run test:run`
- `npm run build`
- `npm run test:smoke`
- `Persistence/family changes: npm run test:database and npm run test:family against isolated fixtures. Native changes: ios/README.md targets plus visual inspection.`

Documentation-only changes require path/link, accuracy, diff and secret-exclusion review; do not run heavyweight builds or production smoke mutations for prose changes. Application tests were not rerun in this pass. Past test/release evidence below retains its original date. UI changes still require actual rendered inspection, and synthetic tests do not prove real provider/device acceptance.

## Decisions and constraints

- Date-only values use household-local calendar dates. Whole-week tasks retain planningDate:null; Day/Week and List/Calendar are independent.
- Due today, inline complete/reopen and Plan today/tomorrow already exist. Failed optimistic saves roll back without losing drafts; create retries keep UUIDs.
- Native reminders and household roles must stay account-scoped. Read installed Next.js docs before changing framework APIs.

## Release state and workflow effects

- Web/API: deployed and verified **2026-11-02**, source `4ed77828defbff00e452de759c7806cf9f45efd3`. Exact revision/readiness and scoped activation were recorded; this documentation pass did not redeploy.
- Native: version **1.3**, build **167**, source `4ed77828defbff00e452de759c7806cf9f45efd3`. **Available in TestFlight**, processing/audience verified November 2 for exactly **1 existing internal tester**; external/public distribution excluded. [Verification evidence](https://github.com/jimgreco/common-week/actions/runs/41463721146). No public App Store release was performed.
- Main publication can build/publish images and the native pipeline. Server activation is separate; inspect current deploy/TestFlight workflow inputs. GET-only verification is available for an already uploaded build.

Recent exact-source GitHub results observed November 2 (workflow purpose matters):

- [Verify existing TestFlight build run 41463721146](https://github.com/jimgreco/common-week/actions/runs/41463721146): `completed` / `success`.
- [Deploy to EC2 run 41079037458](https://github.com/jimgreco/common-week/actions/runs/41079037458): `completed` / `success`.
- [CI run 41079037215](https://github.com/jimgreco/common-week/actions/runs/41079037215): `completed` / `failure`.

The handoff is published on a documentation feature branch, not main. Current checked-in GitHub push triggers are main-only (or absent). Blog hosting branch settings were separately checked. No native release, image publication or server deployment is intended from this documentation push.

## Known gaps and next safe work

- October 23 responsible-person filter d663756 remains paused. The prior native UI failure was resolved before integration; do not weaken assertions to make tests pass.
- November 2 native upload hit a post-upload Apple500; GET-only verification confirmed167. Never reupload solely because the final read failed. Real calendar/notification and physical-device acceptance were not repeated.

Before the next task, verify source HEAD, dirty/staged work and the selected subsystem; read only the relevant guide. Check whether a listed idea is already implemented in another branch before rebuilding it. Preserve unrelated work and paused experiments. Release/permission/data changes require the applicable current authorization.

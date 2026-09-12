<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Week of Us — Codex Guide

## Efficient Start

- Use supplied context once. Before code edits, inspect `git status --short --branch`,
  `git diff --stat`, and `git diff --cached --stat`, then relevant hunks. Preserve
  unrelated work and stage only the requested scope when committing.
- Start with the paths below and narrow `rg` searches. Batch independent reads;
  reuse installed dependencies and build caches unless a change invalidates them.
- Make routine reversible decisions and complete the authorized outcome. Avoid
  speculative cleanup, repeated permission questions, and unrelated work.
- Run meaningful checks for the changed surface once after edits settle, including
  the repository's required gates. Repeat only when new evidence invalidates them.
  Documentation-only edits need diff, link/path, and whitespace review.
- For requested releases, follow the current workflow and verify the final pushed
  SHA and applicable live results. Keep build, deployment, TestFlight upload, and
  physical-device evidence distinct. Report the outcome and actual verification.

## Local Pointers

- Weekly web UI: `src/components/planner/weekly-planner.tsx`; routes: `src/app/`.
- Authorized persistence and provider adapters: `src/lib/server/`,
  `src/lib/integrations/`; migrations: `db/migrations/`.
- Native app, shared/widget code, and tests: `ios/CommonWeek/`, `ios/Shared/`,
  `ios/WeekWidgets/`, `ios/CommonWeekTests/`; build guidance: `ios/README.md`.
- Use `README.md` for household permissions, calendar behavior, recurrence, and
  date-only semantics. Keep relevant web/native behavior aligned.
- Web checks: `npm run lint`, `npm run typecheck`, `npm run test:run`, and
  `npm run build`; use `test:smoke`, `test:database`, or `test:family` when the
  affected behavior requires those journeys. Use the one-shot `test:run` in agents.
- Deployment: `docs/DEPLOYMENT.md` and `.github/workflows/`; use the final commit
  for CI, live deployment, and applicable TestFlight verification.
- Preserve the generated Next.js guidance above. Read the applicable installed
  Next.js documentation before code changes that use its APIs.

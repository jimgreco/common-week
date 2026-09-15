# Acceptance record — September 14, 2026

Scope: recoverable authentication/settings failures (JIM-71), independent provider loading (JIM-73), hourly forecast details (JIM-69), and production acceptance/regression coverage (JIM-72).

This record captures pre-release validation of changes based on `60c7e4486aa6f9aceffeed6d4d86fc67a85ad51d`. CI and release workflows provide deployment and TestFlight evidence for the resulting commit.

## Verified locally

- `npm run check`: lint, type generation, TypeScript checking, 218 component/server tests, production build, and eight browser smoke tests passed.
- Regression scenarios: OAuth denial/expiry messages; retained alias/preference/invitation input; visibility rollback; default-location failure and retry; geocoding errors; HTML server failures; independent calendar/weather completion; stale week/location responses; request cancellation; cached forecasts during a provider outage; missing hourly fields and forecast horizon boundaries.
- Real PostgreSQL migrations and integration tests: authenticated source reads derive identity from the session, including when a caller supplies another household's ID. Core native responses return before provider loading.
- Disposable household integration tests: tasks/backlog, assignments, checklists/comments/files, private-calendar event details, recurrence/templates, review conflicts, pickup/drop-off revision and confirmation ownership, viewer restrictions, and isolation across households.
- Existing browser smoke journeys: eight passed.
- Browser inspection at desktop, 390px, and 320px: weather detail and sign-in recovery layouts. A forced HTTP 503 on a disposable account's Calendar alias save retained its text and displayed Retry; restoring the endpoint and retrying saved the alias.
- iPhone simulator native unit tests: 92 passed across the 91-test suite and an additional sunrise/sunset minute-formatting regression, including partial/complete hourly decoding and existing offline account-isolation/replay coverage.
- iPhone simulator weather UI test passed and its screenshot was inspected; hourly temperature, rain probability, precipitation amount, and wind were visible.
- Mac Catalyst compilation: passed with code signing disabled. The normal development build requires a matching Mac Catalyst development provisioning profile. The unsigned Mac UI runner did not reach test execution and was stopped; Mac UI acceptance remains pending.

Screenshot artifacts are kept locally under `/tmp/planner-finishing-artifacts/`. Test logs are under `/tmp/planner-finishing-*`. These disposable-account and simulator checks are distinct from production acceptance with real accounts.

## Production checks completed

An existing signed-in browser session loaded the deployed household planner, Google events, and forecasts. This read-only check exercised the existing production version, not the local changes above.

## Still requires real-account/device acceptance

The full checklist remains in [SETUP.md](SETUP.md#7-production-acceptance-checklist). Additional test identities are required: another member of the household and an account in a different household. A paired iPhone was detected, but pairing is not evidence that these flows passed on that device.

- Google/Apple sign-in/out, token refresh, and intentional revocation followed by reconnection.
- Two-member production edits, visibility, actor-authorized Google writes, RSVP and recurrence, plus a third account's direct-access rejection.
- Delivered invitation emails, correct/wrong account, expiry, cancellation, resend rotation, and duplicate-invite behavior.
- Physical-device offline replay, real email/APNs timing and deduplication, Complete/Snooze, widgets and Shortcuts.
- Real-account deletion/sign-out cleanup and signed Mac permission behavior.
- After deployment and TestFlight publication, acceptance on that exact version.

JIM-72 remains open until these results are recorded. No production permissions were revoked, real household data deleted, or invitation/notification emails sent during this pass.

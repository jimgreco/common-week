# Week of Us

Week of Us is a shared Monday-through-Sunday family planner. It keeps scheduled Google Calendar commitments, daily location, location-specific weather, and flexible household notes/tasks legible in one view.

The production application uses the existing self-hosted PostgreSQL 16 service. It does not use DynamoDB or Supabase. With no database configuration, it opens as a polished interactive demo so the product can still be evaluated locally.

## Task responsibilities and shared details

Open **Tasks & backlog** to capture unscheduled tasks, claim a responsibility, assign an adult or child, filter Mine/Unassigned/Overdue, and schedule or defer work. Deadlines are separate from planned dates; backlog tasks are excluded from automatic carryover. Assignment changes notify the responsible adult through the existing inbox/email/push system, respecting notification preferences.

Every task, plan, and visible Google event can have a checklist, discussion, and files (up to 5 MB each). Google-event details belong to a single occurrence in Week of Us and do not change Google attendees or require Google write access. Calendar privacy and household viewer permissions still apply. Files are stored in PostgreSQL and downloaded through authenticated access checks. Apply migration `018_task_workspace.sql` before running this version. These new shared-detail operations require a connection; demo changes are saved locally.

## What is implemented

- Independent Google sign-in for each member, read-only Calendar by default, and a separate opt-in for event editing
- Shared single-household model with email-matched partner invitations
- Three-state calendar access: Hide removes a calendar from the app, Private shows it only to its owner, and Share lets household members view it; editing additionally requires Google to grant the acting member write access through their own connected account
- Seven-column desktop week and stacked iPhone week with previous/current/next navigation
- Native SwiftUI iPhone companion with Keychain sessions, Google OAuth handoff, in-app Calendar connection and management, protected offline snapshots, queued planner/location edits, and background refresh
- Daily and weekly notes/tasks, completion, editing, date moves, weekly moves, deletion, search, optimistic saves, and retry state
- Repeating shared tasks with daily, weekday, weekly, and custom-interval schedules; reusable templates for a week's one-off plans and tasks
- Children’s profiles with names, colors, linked calendars, and tagged shared plans/tasks, without creating sign-in accounts
- Guided weekly planning with unfinished work, calendar commitments, routines, children’s schedules, shared priorities/meals/logistics notes, and each adult’s review status
- Email and iPhone-push reminders, morning agendas, Sunday planning prompts, and opt-in household-change alerts with a shared web/native inbox, per-channel delivery history, reliable deep links, and catch-up after downtime
- Calendar search, attendee status and RSVP, plus occurrence-or-series editing and deletion for recurring Google events
- Saved/default/travel locations, day/through-Sunday/whole-week assignment, and Open-Meteo geocoding
- Location-specific daily/hourly weather with honest forecast-unavailable states and PostgreSQL caching
- Prompt collaboration through PostgreSQL `LISTEN/NOTIFY`, authenticated server-sent events on web and iPhone, automatic reconnect, background native refresh, and a web polling fallback
- Database-backed opaque sessions, PKCE OAuth state validation, encrypted Google tokens, CSP/security headers, and parameterized server-only data access
- Exact-SHA container publishing and deployment through the consolidated server Compose project

## Run it

For the interactive demo:

```bash
npm install
npx playwright install chromium
npm run dev
```

For durable local storage, create the `common_week` PostgreSQL database, copy `.env.example` to `.env.local`, set `ENABLE_DEMO=false`, and run:

```bash
npm run db:migrate
npm run dev
```

See [PostgreSQL and Google setup](docs/SETUP.md) for the complete setup.

Useful verification commands:

```bash
npm run lint
npm run typecheck
npm run test:run
npm run build && npm run test:smoke
npm run db:migrate
npm run test:database
npm run test:family
```

The native app lives in [`ios`](ios). Open [`ios/CommonWeek.xcodeproj`](ios/CommonWeek.xcodeproj) in Xcode, or see the [iPhone development guide](ios/README.md) for project generation, simulator, and API setup.

## Architecture

- **Next.js App Router:** planning data renders first; Calendar and weather hydrate independently so either provider can fail without taking down the planner.
- **SwiftUI iPhone app:** native weekly cards, editors, search, weather, settings, and Google Calendar controls use a small authenticated API over the same server-side authorization boundary.
- **Local PostgreSQL:** the `common_week` database holds users, sessions, household data, planning data, saved locations, calendar preferences, encrypted provider credentials, and provider caches.
- **Server-only authorization boundary:** the browser has no database credential or generic data API. Every read/write derives user and household identity from an opaque HTTP-only session and includes that trusted household in its SQL predicate.
- **Provider boundaries:** `GoogleCalendarService`, `WeatherProvider`, and `GeocodingService` normalize external data before it reaches the UI.
- **Date safety:** planning dates remain `YYYY-MM-DD` strings; Monday boundaries are computed without converting date-only values through UTC.
- **Realtime:** PostgreSQL triggers publish only household/table identifiers; the authenticated event stream filters those notifications and never exposes row data.
- **Credential boundary:** Google access and refresh tokens are encrypted with AES-256-GCM before storage and are used only in server modules.

## Family planning

Open **Plan this week** from the planner, or **Plan next week** to prepare the coming week. The guide brings unfinished tasks, calendar commitments, recurring routines, children, shared notes, and review status into one workflow. The Sunday planning notification opens this guide for the coming week.

- Under **Family → Adults**, assign calendars to existing household members. A calendar can belong to multiple adults’ schedules. The **Person** filter follows these assignments rather than the Google account supplying events. Existing and new calendars initially retain their connected adult; assignments can be changed or cleared without changing sharing or edit permissions.
- Add children by name and color in the guide. Linking a calendar keeps its existing visibility and editing permissions. Tag a shared task or plan with a child to include it in that child’s week; children do not need an account or email address.
- Create recurring shared tasks in **Routines**. Each scheduled occurrence has its own completion state. Weekly routines can belong to the whole week or selected weekdays. Custom intervals cover schedules such as every other week.
- Editing or stopping a routine updates its open future occurrences. Completed tasks, past occurrences, and explicitly deleted occurrences are preserved. Reloading a week cannot recreate a deleted occurrence. Existing unfinished-task carryover continues to preserve task identity.
- Save a week’s one-off plans and tasks as a named template and apply it to another week. Repeating tasks already come from their routines and are excluded from templates. Applying the same template twice to the same week does not duplicate items.
- Save shared priorities, meal ideas, and logistics notes, then mark the week reviewed. Each adult reviews for themselves. Changing the shared notes requires a new review; simultaneous edits report a conflict rather than silently replacing another person’s notes.

Apply migrations `015_family_planning.sql` and `016_adult_calendar_assignments.sql` before deploying these features. Profile, routine, template, and review changes require a connection; native shared-task editing retains its existing offline support. Recurring tasks are generated when a current or future week is loaded, up to two years ahead; browsing older weeks does not create historical chores.

After a production build, `DATABASE_URL=... npm run test:family` starts a local authenticated application and checks the family workflows against PostgreSQL. It creates isolated test households and removes them when finished. Set `FAMILY_TEST_BASE_URL` to test an already running local application instead.

Key paths:

- [`src/components/planner/weekly-planner.tsx`](src/components/planner/weekly-planner.tsx) — interactive weekly experience
- [`src/lib/server/planner-data.ts`](src/lib/server/planner-data.ts) — authorized planner assembly
- [`src/lib/server/session.ts`](src/lib/server/session.ts) — opaque PostgreSQL sessions
- [`ios/CommonWeek`](ios/CommonWeek) — native SwiftUI application
- [`src/lib/integrations`](src/lib/integrations) — normalized provider adapters
- [`db/migrations`](db/migrations) — PostgreSQL schema, indexes, triggers, and incremental data-model changes
- [`scripts/test-database.mjs`](scripts/test-database.mjs) — real-PostgreSQL isolation and constraint checks

## Setup and deployment

- [PostgreSQL, Google OAuth, and Calendar setup](docs/SETUP.md)
- [Weather and geocoding integration](docs/WEATHER.md)
- [Consolidated EC2 deployment](docs/DEPLOYMENT.md)

## Current V1 constraints

- Household owners and members can create, edit, and delete events on visible calendars only when their own connected Google account has write access. A calendar another member Shares in Week of Us remains read-only until its Google owner also grants the acting member permission to make changes and the acting member enables Calendar editing. Private, hidden, Google read-only, and viewer-access calendars remain non-editable. RSVP is intentionally limited to the signed-in member's own connected Google account.
- Forecasts use Open-Meteo's useful forecast horizon. Past weather is not reconstructed.
- Collaboration is item-level last-write-wins, not simultaneous rich-text editing.
- Offline iPhone replay covers plans, tasks, completion, deletion, and location assignment. Google Calendar changes remain online-only so stale provider ETags are never replayed.
- Google Cloud credentials and the public proxy/DNS still require operator setup before real-account production acceptance testing.

## Recommended next feature

After both household accounts complete production acceptance, add operator-facing notification delivery metrics so repeated provider failures are visible before a household reports them.

Household assignments: the Person filter includes adults and children. Plans, tasks, routines, and week templates retain any selected combination of household members. Event details let editors save an occurrence-specific household assignment or restore calendar defaults; these Week of Us associations also work for Google events without changing Google attendees. Migration `017_household_assignments.sql` is required.

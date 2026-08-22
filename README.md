# Week of Us

Week of Us is a shared Monday-through-Sunday family planner. It keeps scheduled Google Calendar commitments, daily location, location-specific weather, and flexible household notes/tasks legible in one view.

The production application uses the existing self-hosted PostgreSQL 16 service. It does not use DynamoDB or Supabase. With no database configuration, it opens as a polished interactive demo so the product can still be evaluated locally.

## What is implemented

- Independent Google sign-in for each member, read-only Calendar by default, and a separate opt-in for event editing
- Shared single-household model with email-matched partner invitations
- Three-state calendar access: Hide removes a calendar from the app, Private shows it only to its owner, and Share lets household members view and edit events when the calendar owner has enabled Google write access; newly discovered calendars start hidden
- Seven-column desktop week and stacked iPhone week with previous/current/next navigation
- Native SwiftUI iPhone companion with Keychain sessions, Google OAuth handoff, in-app Calendar connection and management, protected offline snapshots, queued planner/location edits, and background refresh
- Daily and weekly notes/tasks, completion, editing, date moves, weekly moves, deletion, search, optimistic saves, and retry state
- Saved/default/travel locations, day/through-Sunday/whole-week assignment, and Open-Meteo geocoding
- Location-specific daily/hourly weather with honest forecast-unavailable states and PostgreSQL caching
- Prompt collaboration through PostgreSQL `LISTEN/NOTIFY`, authenticated server-sent events on web and iPhone, automatic reconnect, background native refresh, and a web polling fallback
- Database-backed opaque sessions, PKCE OAuth state validation, encrypted Google tokens, CSP/security headers, and parameterized server-only data access
- Exact-SHA container publishing and deployment through the consolidated server Compose project

## Run it

For the interactive demo:

```bash
npm install
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
npm run db:migrate
npm run test:database
npm run build
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

- Invitations are recorded securely but not emailed. The partner opens the app and signs in with the invited Google address.
- Household owners and members can create, edit, and delete events on visible calendars they connected and on calendars another member explicitly Shared when that calendar's Google connection has write access. Private, hidden, read-only, and viewer-access calendars remain non-editable. For recurring events, editing or deleting in Week of Us affects only the selected occurrence; whole-series editing, RSVP, and Calendar search remain absent.
- Forecasts use Open-Meteo's useful forecast horizon. Past weather is not reconstructed.
- Collaboration is item-level last-write-wins, not simultaneous rich-text editing.
- Offline iPhone replay covers plans, tasks, completion, deletion, and location assignment. Google Calendar changes remain online-only so stale provider ETags are never replayed.
- Google Cloud credentials and the public proxy/DNS still require operator setup before real-account production acceptance testing.

## Recommended next feature

After both household accounts complete production acceptance, add transactional invitation email with a signed deep link. It closes the only manual onboarding step without expanding the product into a task manager.

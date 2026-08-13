# Week of Us

Week of Us is a shared Monday-through-Sunday family planner. It keeps scheduled Google Calendar commitments, daily location, location-specific weather, and flexible household notes/tasks legible in one view.

The production application uses the existing self-hosted PostgreSQL 16 service. It does not use DynamoDB or Supabase. With no database configuration, it opens as a polished interactive demo so the product can still be evaluated locally.

## What is implemented

- Independent Google sign-in for each member, read-only Calendar by default, and a separate opt-in for single-event editing
- Shared single-household model with email-matched partner invitations
- Selected primary, additional, and shared calendars with aliases, colors, all-day/timed/multi-day events, and conflict flags
- Seven-column desktop week and stacked iPhone week with previous/current/next navigation
- Native SwiftUI iPhone companion with Keychain sessions, Google OAuth handoff, and full planner editing
- Daily and weekly notes/tasks, categories, completion, editing, date moves, weekly moves, deletion, search, optimistic saves, and retry state
- Saved/default/travel locations, day/through-Sunday/whole-week assignment, and Open-Meteo geocoding
- Location-specific daily/hourly weather with honest forecast-unavailable states and PostgreSQL caching
- Prompt collaboration through PostgreSQL `LISTEN/NOTIFY`, server-sent events, automatic reconnect, and a polling fallback
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
- [`db/migrations/001_initial_common_week.sql`](db/migrations/001_initial_common_week.sql) — PostgreSQL schema, indexes, triggers, and default categories
- [`scripts/test-database.mjs`](scripts/test-database.mjs) — real-PostgreSQL isolation and constraint checks

## Setup and deployment

- [PostgreSQL, Google OAuth, and Calendar setup](docs/SETUP.md)
- [Weather and geocoding integration](docs/WEATHER.md)
- [Consolidated EC2 deployment](docs/DEPLOYMENT.md)

## Current V1 constraints

- Invitations are recorded securely but not emailed. The partner opens the app and signs in with the invited Google address.
- Single non-recurring events can be created, edited, and deleted only by the member who connected a Google calendar with write access. Recurring-event editing, RSVP, and Calendar search remain absent.
- Forecasts use Open-Meteo's useful forecast horizon. Past weather is not reconstructed.
- Collaboration is item-level last-write-wins, not simultaneous rich-text editing.
- Google Cloud credentials and the public proxy/DNS still require operator setup before real-account production acceptance testing.

## Recommended next feature

After both household accounts complete production acceptance, add transactional invitation email with a signed deep link. It closes the only manual onboarding step without expanding the product into a task manager.

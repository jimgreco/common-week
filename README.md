# Common Week

Common Week is a shared Monday-through-Sunday family planner. It keeps four different kinds of information legible in one view: scheduled Google Calendar commitments, daily location, location-specific weather, and flexible household notes/tasks.

The repository contains a deployable Next.js application plus the Supabase schema, Row Level Security policies, provider adapters, tests, and setup documentation required for V1. With no environment variables, it opens as a polished interactive demo so the product can be evaluated immediately.

## What is implemented

- Google sign-in and per-user read-only Google Calendar authorization
- Shared single-household model with email-matched partner invitations
- Selected primary, secondary, and shared calendars with aliases, colors, all-day/timed/multi-day events, and subtle conflict flags
- Seven-column desktop week and stacked iPhone week with previous/current/next navigation
- Daily and weekly notes/tasks, categories, completion, editing, date moves, weekly moves, deletion, search, optimistic saves, retry state, and realtime refresh
- Saved/default/travel locations, Open-Meteo geocoding, and day/through-Sunday/entire-week assignment
- Open-Meteo daily and hourly weather with forecast-horizon truthfulness, provider-error isolation, Fahrenheit/Celsius display, and database caching
- Settings for household, members, invitations, calendar selection/aliases, locations, timezone, and temperature unit
- Supabase RLS, server-only OAuth credentials/cache tables, CSP and security headers, strict server validation, CI, unit/component tests, and pgTAP policy checks

## Run it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Without Supabase variables, `Common Week` runs in demo mode. For a real household, follow [Supabase and Google setup](docs/SETUP.md).

Useful commands:

```bash
npm run lint
npm run typecheck
npm run test:run
npm run build
npm run check
```

## Architecture

- **Next.js App Router:** the household plan renders first, then a server action hydrates Calendar/weather without blocking it; writes use Server Actions and the client planner handles optimistic interaction and Supabase Realtime refreshes.
- **Supabase/PostgreSQL:** durable household data, auth sessions, email-matched invitations, cache tables, and RLS-enforced household isolation.
- **Provider boundaries:** `GoogleCalendarService`, `WeatherProvider`, and `GeocodingService` normalize external data before it reaches the UI.
- **Date safety:** planning dates remain `YYYY-MM-DD` strings; Monday boundaries are computed without converting date-only values through a user timezone.
- **Independent failure domains:** calendar and weather adapters return their own source state, while shared planning data remains usable.
- **Credential boundary:** Google access/refresh tokens and the Supabase service-role key are imported only by server-only modules and are never returned to the browser.

Key paths:

- [`src/components/planner/weekly-planner.tsx`](src/components/planner/weekly-planner.tsx) — interactive weekly experience
- [`src/lib/server/planner-data.ts`](src/lib/server/planner-data.ts) — planner data assembly
- [`src/lib/integrations`](src/lib/integrations) — normalized provider adapters
- [`supabase/migrations/202608100001_initial_family_planner.sql`](supabase/migrations/202608100001_initial_family_planner.sql) — schema, indexes, functions, policies, Realtime
- [`supabase/tests/household_isolation.sql`](supabase/tests/household_isolation.sql) — database policy assertions
- [`security_best_practices_report.md`](security_best_practices_report.md) — security review

## Setup and deployment

- [Supabase, Google OAuth, and Calendar setup](docs/SETUP.md)
- [Weather and geocoding integration](docs/WEATHER.md)
- [EC2 and Vercel deployment](docs/DEPLOYMENT.md)

## Current V1 constraints

- Creating an invitation records it securely; V1 does not send transactional invitation email. The partner signs in using the invited Google email and joins automatically.
- Google Calendar is intentionally read-only. Calendar writes, RSVP, and Google Calendar search are absent.
- Forecasts use Open-Meteo's useful forecast horizon. Future dates outside it say “Forecast not yet available,” and past weather is not reconstructed.
- Realtime is item-level last-write-wins, not simultaneous rich-text collaboration.
- A real two-account/RLS/OAuth smoke test requires the project's Supabase and Google credentials; the local demo and automated application tests do not substitute for that environment check.

## Recommended next feature

After V1 is deployed and exercised by both household members, add transactional invitation email with a signed deep link. It closes the only manual onboarding step without expanding the planner into task management or calendar editing.

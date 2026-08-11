# Supabase and Google setup

## 1. Create and migrate Supabase

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local`.
3. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and the server-only `SUPABASE_SERVICE_ROLE_KEY` from the Supabase project settings.
4. Apply the migration:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

The migration creates the complete data model, indexes, default categories, helper functions, Row Level Security policies, and Realtime publication. Never expose the service-role key in a `NEXT_PUBLIC_` variable.

For a local database policy check:

```bash
npx supabase start
npx supabase db reset
npx supabase test db
```

The included pgTAP test is a structural smoke test. Before production launch, also perform the two-account isolation test in the checklist below.

## 2. Configure Google Cloud

1. In Google Cloud Console, create or select a project.
2. Enable **Google Calendar API**.
3. Configure the OAuth consent screen and add only these scopes:
   - `openid`
   - `email`
   - `profile`
   - `https://www.googleapis.com/auth/calendar.readonly`
4. Create a **Web application** OAuth client.
5. Add the Supabase callback as an authorized redirect URI:

```text
https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
```

6. If the consent screen is in testing, add both household Google accounts as test users.

No Calendar write scope is requested or used.

## 3. Configure Supabase Auth

In **Authentication → Providers → Google**, enable Google and enter the OAuth client ID and secret from Google Cloud.

In **Authentication → URL Configuration**:

- Set the local Site URL to `http://localhost:3000` during development or the canonical HTTPS origin in production.
- Add `http://localhost:3000/auth/callback` and `https://YOUR_DOMAIN/auth/callback` to the redirect allow list.

Set the same Google client credentials as server-only application variables:

```text
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

They are required to refresh each member's Calendar authorization independently. `NEXT_PUBLIC_APP_URL` must be an exact origin without a trailing path.

## 4. Create and join a household

1. Sign in with the first Google account.
2. Create the household on the onboarding page.
3. Add at least one saved location and make it the default.
4. In Settings, invite the second member's exact Google email.
5. Sign out, then sign in with that invited Google account. The callback accepts a non-expired invitation matching the authenticated email.
6. Each member chooses their own visible calendars and aliases in Settings. OAuth credentials are never shared between members.

V1 records an invitation but does not deliver an email. Send the app URL to the partner separately.

## 5. Production acceptance checklist

- Sign in, sign out, and wait long enough to exercise session and Google token refresh.
- Revoke the app in one Google account and confirm only Calendar degrades to a reconnect state.
- Create one household with two accounts; verify both see and edit the same planning item via Realtime.
- With a third account, attempt direct reads/writes against every household table and confirm no rows are returned or changed.
- Select primary, extra, and shared calendars; check timed, all-day, recurring-expanded, and multi-day events.
- Exercise dates around a month boundary, year boundary, and DST transition.
- Change Friday's location through Sunday and confirm all three weather summaries refresh.
- Disable the network during quick entry; confirm typed text remains with Retry.

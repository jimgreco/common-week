# PostgreSQL and Google setup

## 1. Configure local PostgreSQL

Week of Us uses an ordinary PostgreSQL 16 database. DynamoDB is not involved.

Create a dedicated database and login role as a PostgreSQL administrator:

```sql
create role common_week_app login password 'replace-with-a-long-random-password';
create database common_week owner common_week_app;
```

Copy `.env.example` to `.env.local`, set the connection string, and disable demo mode:

```dotenv
DATABASE_URL=postgresql://common_week_app:YOUR_PASSWORD@127.0.0.1:5432/common_week
PGSSL=false
ENABLE_DEMO=false
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Apply migrations:

```bash
npm run db:migrate
```

Migrations are recorded in `app_schema_migrations` and are safe to run again. The schema includes the household model, opaque sessions, planning data, locations, date constraints, provider caches, indexes, and collaboration notification triggers.

The production workflow creates the `common_week_app` role and `common_week` database on the existing shared PostgreSQL container if needed. It generates an independent database password on the server rather than sharing the administrator credential with the app.

## 2. Configure Google Cloud

1. Create or select a Google Cloud project.
2. Enable **Google Calendar API**.
3. Configure the OAuth consent screen with:
   - `openid`
   - `email`
   - `profile`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   - `https://www.googleapis.com/auth/calendar.events.readonly`
   - `https://www.googleapis.com/auth/calendar.events`
4. Create a **Web application** OAuth client.
5. Add the exact authorized redirect URI:

```text
http://localhost:3000/auth/callback
```

For production also add:

```text
https://weekofus.com/auth/callback
```

6. If the consent screen is in testing, add both household Google accounts as test users.

Set the server-only credentials and generate a token-encryption key:

```bash
openssl rand -base64 32
```

```dotenv
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_TOKEN_ENCRYPTION_KEY=the-generated-base64-value
```

The OAuth flow uses state validation and PKCE. Each member's access/refresh tokens are separate and encrypted before PostgreSQL storage. Normal sign-in requests the least-privilege `calendar.calendarlist.readonly` and `calendar.events.readonly` scopes so the app can discover calendars and display their events without write access. Discovered calendars start hidden. In Settings, each owner chooses Hide (not shown in Week of Us), Private (shown only to that owner), or Share (shown to the household). The member must separately choose **Enable calendar editing** before Week of Us requests `calendar.events`; only that member's visible, writable calendars become editable. The broader `calendar.events` scope, rather than `calendar.events.owned`, is required because the product supports calendars the connected user can write to but does not own, including shared household calendars.

Configure the Google Auth Platform Data Access screen with exactly the same three Calendar scopes requested by the app: `calendar.calendarlist.readonly`, `calendar.events.readonly`, and `calendar.events`. Complete Google's verification process for general public use. While the consent screen is in testing, both household accounts must remain listed as test users.

## 3. Create and join a household

1. Sign in with the first Google account.
2. Create the household on the onboarding page.
3. Add a saved location and make it the default.
4. Invite the second member's exact Google email in Settings.
5. Sign out, then sign in with the invited account. A current invitation matching Google's verified email is accepted atomically.
6. Each member chooses Hide, Private, or Share for every calendar, then optionally sets aliases and badges for visible calendars.
7. Each member who wants event editing enables it separately in Settings and confirms that writable calendars show the editing-enabled state.

## 4. Verify PostgreSQL isolation

Against a migrated disposable database:

```bash
DATABASE_URL=postgresql://... npm run test:database
```

This exercises household-scoped item reads/writes, cross-household location rejection, session-to-membership resolution, the retired category schema, and date/week constraints against real PostgreSQL.

The browser never connects to PostgreSQL. Household identity comes from the server-side session, not form/query input, and every shared-data query includes that authenticated household boundary.

## 5. Production acceptance checklist

- Sign in/out and exercise both the app session and Google access-token refresh.
- Revoke Google authorization for one member and confirm only Calendar degrades to reconnect state.
- Verify two members see each other's planning changes promptly.
- Use a third account in a different household and attempt item IDs and location IDs from the first household; confirm no reads or writes succeed.
- Select primary, additional, and shared calendars; check timed, all-day, recurring-expanded, and multi-day events.
- Set one calendar to Hide and confirm it is absent for its owner, set one to Private and confirm only its owner sees it, then set one to Share and confirm another household member sees its name and events through the live planner update.
- Create, edit, and delete an event on the signed-in member's writable calendar. Confirm a recurring edit or deletion affects only the selected occurrence, a partner's calendar stays read-only, and Hide affects Week of Us without deleting from Google.
- Exercise month, year, and DST boundaries.
- Change Friday's location through Sunday and confirm all three weather summaries refresh.
- Interrupt the network during quick entry and confirm typed text stays visible with Retry.

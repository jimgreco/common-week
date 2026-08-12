# PostgreSQL and Google setup

## 1. Configure local PostgreSQL

Common Week uses an ordinary PostgreSQL 16 database. DynamoDB is not involved.

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

Migrations are recorded in `app_schema_migrations` and are safe to run again. The schema includes the household model, opaque sessions, planning data, locations, date constraints, provider caches, indexes, default categories, and collaboration notification triggers.

The production workflow creates the `common_week_app` role and `common_week` database on the existing shared PostgreSQL container if needed. It generates an independent database password on the server rather than sharing the administrator credential with the app.

## 2. Configure Google Cloud

1. Create or select a Google Cloud project.
2. Enable **Google Calendar API**.
3. Configure the OAuth consent screen with only:
   - `openid`
   - `email`
   - `profile`
   - `https://www.googleapis.com/auth/calendar.readonly`
4. Create a **Web application** OAuth client.
5. Add the exact authorized redirect URI:

```text
http://localhost:3000/auth/callback
```

For production also add:

```text
https://common-week.jim-greco.com/auth/callback
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

The OAuth flow uses state validation and PKCE. Each member's access/refresh tokens are separate and encrypted before PostgreSQL storage. No Calendar write scope is requested.

## 3. Create and join a household

1. Sign in with the first Google account.
2. Create the household on the onboarding page.
3. Add a saved location and make it the default.
4. Invite the second member's exact Google email in Settings.
5. Sign out, then sign in with the invited account. A current invitation matching Google's verified email is accepted atomically.
6. Each member selects and aliases their own visible calendars.

## 4. Verify PostgreSQL isolation

Against a migrated disposable database:

```bash
DATABASE_URL=postgresql://... npm run test:database
```

This exercises household-scoped item reads/writes, cross-household category and location rejection, session-to-membership resolution, and date/week constraints against real PostgreSQL.

The browser never connects to PostgreSQL. Household identity comes from the server-side session, not form/query input, and every shared-data query includes that authenticated household boundary.

## 5. Production acceptance checklist

- Sign in/out and exercise both the app session and Google access-token refresh.
- Revoke Google authorization for one member and confirm only Calendar degrades to reconnect state.
- Verify two members see each other's planning changes promptly.
- Use a third account in a different household and attempt item IDs, category IDs, and location IDs from the first household; confirm no reads or writes succeed.
- Select primary, additional, and shared calendars; check timed, all-day, recurring-expanded, and multi-day events.
- Exercise month, year, and DST boundaries.
- Change Friday's location through Sunday and confirm all three weather summaries refresh.
- Interrupt the network during quick entry and confirm typed text stays visible with Retry.

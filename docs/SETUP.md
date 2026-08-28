# PostgreSQL, Apple, Google, and email setup

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
2. Enable **Google Calendar API** and **Places API (New)**. Places requires a billing account even though Calendar OAuth does not.
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
GOOGLE_PLACES_API_KEY=...
GOOGLE_TOKEN_ENCRYPTION_KEY=the-generated-base64-value
```

Create a separate server API key for `GOOGLE_PLACES_API_KEY`. Restrict it to **Places API (New)** and to the production server's outbound IP address. Do not prefix it with `NEXT_PUBLIC_` or embed it in the web or iPhone client. Set a Maps Platform quota and billing alert before production use. The key powers event-location autocomplete only; household weather-location search remains on Open-Meteo.

The OAuth flow uses state validation and PKCE. Each member's access/refresh tokens are separate and encrypted before PostgreSQL storage. Normal sign-in requests the least-privilege `calendar.calendarlist.readonly` and `calendar.events.readonly` scopes so the app can discover calendars and display their events without write access. Discovered calendars start hidden. In Settings, each owner chooses Hide (not shown in Week of Us), Private (shown only to that owner), or Share (shown to the household). The calendar owner must separately choose **Enable calendar editing** before Week of Us requests `calendar.events`; then household owners and members can add, edit, and delete events on that owner's Shared writable calendars. Private and hidden calendars, read-only Google calendars, and viewer household roles remain non-editable. The broader `calendar.events` scope, rather than `calendar.events.owned`, is required because the product supports calendars the connected user can write to but does not own, including shared household calendars.

Configure the Google Auth Platform Data Access screen with exactly the same three Calendar scopes requested by the app: `calendar.calendarlist.readonly`, `calendar.events.readonly`, and `calendar.events`. Complete Google's verification process for general public use. While the consent screen is in testing, both household accounts must remain listed as test users.

## 3. Configure Sign in with Apple

1. Enable **Sign in with Apple** for the App ID `com.jimgreco.commonweek` and regenerate the App Store provisioning profile with that entitlement.
2. Create a Services ID for the website, associate it with the primary App ID, verify `weekofus.com`, and register `https://weekofus.com/auth/apple/callback` as a return URL.
3. Create a Sign in with Apple key associated with the primary App ID and securely store its `.p8` private key.
4. Configure `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_SERVICE_ID`, and `APPLE_BUNDLE_ID`. The private key can use literal `\n` sequences in an environment variable.

The server verifies Apple signatures, issuer, audience, expiry, verified email, and nonce; validates the one-use authorization code; encrypts the returned refresh token; and revokes that authorization during self-service account deletion.

## 4. Configure email and push notifications

Verify a sending domain in Resend and set `RESEND_API_KEY`, `INVITATION_EMAIL_FROM`, and `NOTIFICATION_EMAIL_FROM`. Invitation delivery uses a unique idempotency key, and every resend rotates the 256-bit private link and resets its 14-day expiry. Notification email also uses idempotency keys so a delivery cycle cannot intentionally send the same message twice.

Enable Push Notifications for the App ID `com.jimgreco.commonweek`, create an Apple Push Notifications authentication key, and configure `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY_BASE64`, and `APNS_BUNDLE_ID`. The APNs key is distinct from the Sign in with Apple key. The TestFlight workflow enables the bundle capability and verifies that the signed archive contains `aps-environment=production`.

The notification scheduler runs inside the production Node process once per minute. PostgreSQL deduplicates reminders and digests, and records delivery attempts. Morning and Sunday times are interpreted in the household timezone. Users opt into agenda, planning, and change alerts in Settings; an explicit item or event reminder is delivered using their enabled email and/or push channels.

## 5. Create and join a household

1. Sign in with Apple or Google.
2. Create the household on the onboarding page.
3. Add a saved location and make it the default.
4. Invite the second member's exact sign-in email in Settings and open the delivered private link.
5. Sign out, then sign in with the invited Apple or Google account. A current invitation matching the provider's verified email is accepted atomically.
6. Each member chooses Hide, Private, or Share for every calendar, then optionally sets aliases and badges for visible calendars.
7. Each calendar owner who wants household event editing enables it separately in Settings and confirms that their Shared writable calendars are editable by the other household member.

On iPhone, these controls are native: open the account menu, choose **Settings**, then use **Google Calendar** to manage calendars and **Notifications** to configure agenda, planning, household-change, email, and push preferences.

## 6. Verify PostgreSQL isolation

Against a migrated disposable database:

```bash
DATABASE_URL=postgresql://... npm run test:database
```

This exercises household-scoped item reads/writes, cross-household location rejection, session-to-membership resolution, the retired category schema, and date/week constraints against real PostgreSQL.

The browser never connects to PostgreSQL. Household identity comes from the server-side session, not form/query input, and every shared-data query includes that authenticated household boundary.

## 7. Production acceptance checklist

- Sign in/out and exercise both the app session and Google access-token refresh.
- Revoke Google authorization for one member and confirm only Calendar degrades to reconnect state.
- Verify two members see each other's planning changes promptly.
- Use a third account in a different household and attempt item IDs and location IDs from the first household; confirm no reads or writes succeed.
- Select primary, additional, and shared calendars; check timed, all-day, recurring-expanded, and multi-day events.
- Set one calendar to Hide and confirm it is absent for its owner, set one to Private and confirm only its owner sees it, then set one to Share and confirm another household member sees its name and events through the live planner update.
- From both household accounts, create, edit, and delete an event on each Shared writable calendar. Confirm occurrence and whole-series operations target the intended Google event; Private, hidden, viewer-access, and Google read-only calendars stay read-only; and Hide affects Week of Us without deleting from Google.
- Search for a Calendar event outside the visible week, open it, and respond to an invitation from the connected account that received it. Confirm another household member cannot RSVP through the calendar owner's credentials.
- Enable email and push delivery, set an item and event reminder, and exercise morning, Sunday, and household-change alerts. Confirm each message is delivered once in the household timezone.
- Exercise month, year, and DST boundaries.
- Change Friday's location through Sunday and confirm all three weather summaries refresh.
- Interrupt the iPhone network, confirm the protected cached week remains visible, create/update/complete/delete planner items and change a location, then restore connectivity and confirm the queued edit count returns to zero without duplicates.
- Exercise invite delivery, resend, cancel, member removal, leave, and owner transfer. Confirm expired/revoked links fail closed.
- Delete a non-owner account and a sole-owner account from both web and iPhone; confirm data and local cache are removed and Apple/Google access is revoked. Confirm an owner with remaining members must transfer ownership first.

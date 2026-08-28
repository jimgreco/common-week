# Week of Us for iPhone

The iPhone app is a native SwiftUI companion to the Week of Us web app. It uses the same household, planner, weather, location, and Google Calendar data while keeping its opaque session token in the iOS Keychain.

## Open and run

Open `CommonWeek.xcodeproj` in Xcode, choose the `CommonWeek` scheme, and run on an iPhone simulator or device. The checked-in project is generated from `project.yml`; after changing the project definition, regenerate it with:

```bash
cd ios
xcodegen generate
```

The Debug and Release configurations use `https://weekofus.com` as `API_BASE_URL`. Change that value in `CommonWeek/Info.plist` when pointing a local build at another server.

For a network-free interactive preview in Simulator, launch the app with `COMMON_WEEK_DEMO=1` in the scheme environment. Preview mutations stay in memory.

## Authentication

Sign-in starts the existing Google OAuth flow in `ASWebAuthenticationSession`. The server returns a five-minute, one-use authorization code through the `commonweek://auth` callback. The app exchanges that code and its original random state for a 30-day opaque session token, which is stored in Keychain and sent as a Bearer credential.

After sign-in, iPhone Settings can connect or reconnect Google Calendar, request the separate editing permission, refresh calendar discovery, manage each calendar's Hide, Private, Share, alias, badge, and planner-section settings, and configure notification delivery without leaving the app. Calendar search, RSVP, reminders, and recurring occurrence-or-series controls are native as well. Google tokens and database credentials remain server-side.

Apple Reminders is an optional, device-local task source. After granting full Reminders access, each signed-in user selects the lists to show and can choose Week of Us or a writable selected list as the default destination for new daily tasks. Only reminders with due dates appear. Open overdue reminders use the same carry-forward placement and label as native daily tasks without changing their Apple due date. Weekly quick-add always creates a Week of Us task. Apple reminders can be completed or reopened; non-recurring reminders on writable lists can also be edited or deleted. Recurring reminders are completion-only, and no Apple Reminders data is uploaded to the server or displayed on the web.

For push delivery, enable Push Notifications for `com.jimgreco.commonweek` and use a provisioning profile containing `aps-environment`. The app requests notification permission only when the user enables push, registers the APNs token with the server, and keeps the token associated with the signed-in account.

## Offline and live synchronization

The app stores account-isolated planner snapshots in Application Support with iOS file protection and excludes them from device backups. Plans, tasks, completion changes, deletion, and saved or searched location assignments are applied immediately and queued durably when the network is unavailable. The queue replays automatically on foregrounding, pull-to-refresh, a live household change, or an iOS background refresh. Native-created item IDs and idempotent deletion make replay safe when the server applied a request but its response was lost.

The same household-scoped PostgreSQL event stream used by the website accepts the native Bearer session and refreshes the visible week after another member changes it. iOS schedules `com.jimgreco.commonweek.refresh` with `BGAppRefreshTask`; execution time remains discretionary under the operating system. Google Calendar create, edit, delete, and hide operations intentionally remain online-only because replaying a stale provider ETag could overwrite a newer Google-side change.

Before using real sign-in, deploy migration `006_native_auth.sql` and the matching Next.js routes. Google still redirects to the existing HTTPS `/auth/callback`; no new Google Console callback is required.

## Verification

```bash
xcodebuild -project CommonWeek.xcodeproj \
  -scheme CommonWeek \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  test
```

The app targets iOS 26 and the bundle identifier is `com.jimgreco.commonweek`.

## TestFlight releases

Every push to `main` runs the server checks and iOS simulator tests in `.github/workflows/ci.yml`. After both pass, the reusable `.github/workflows/testflight.yml` archives and uploads that exact commit to TestFlight. A manually dispatched CI run on `main` follows the same release path.

Configure these GitHub Actions secrets before the first release:

- `APPLE_TEAM_ID`
- `IOS_DIST_CERT_P12` — base64-encoded Apple Distribution `.p12`
- `IOS_DIST_CERT_PASSWORD`
- `IOS_PROVISIONING_PROFILE` — base64-encoded App Store profile for `com.jimgreco.commonweek`
- `IOS_PROVISIONING_PROFILE_NAME`
- `KEYCHAIN_PASSWORD`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_API_KEY` — PEM text or base64-encoded PEM

The server deployment also requires `COMMON_WEEK_RESEND_API_KEY`, both email-from secrets, and a dedicated `COMMON_WEEK_APNS_KEY_ID` / `COMMON_WEEK_APNS_PRIVATE_KEY_BASE64` pair.

App Store Connect must also contain a Week of Us app record for `com.jimgreco.commonweek`, and the provisioning profile must be an active App Store distribution profile for that identifier.

The optional repository variable `IOS_API_BASE_URL` can override the production API URL. Release validation requires the canonical `https://weekofus.com` origin.

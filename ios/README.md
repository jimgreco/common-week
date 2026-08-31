# Week of Us for iPhone and Mac

The SwiftUI app is a native companion to the Week of Us web app. It uses the same household, planner, weather, location, and Google Calendar data while keeping its opaque session token in the Apple Keychain. The existing iOS target also produces the first Mac app with Mac Catalyst and the same `com.jimgreco.commonweek` bundle identifier.

## Open and run

Open `CommonWeek.xcodeproj` in Xcode, choose the `CommonWeek` scheme, and run on an iPhone simulator/device or the **My Mac (Mac Catalyst)** destination. The checked-in project is generated from `project.yml`; after changing the project definition, regenerate it with:

```bash
cd ios
xcodegen generate
```

The Debug and Release configurations use `https://weekofus.com` as `API_BASE_URL`. Change that value in `CommonWeek/Info.plist` when pointing a local build at another server.

For a network-free interactive preview in Simulator, launch the app with `COMMON_WEEK_DEMO=1` in the scheme environment. Preview mutations stay in memory.

## Mac Catalyst milestone

Mac Catalyst is enabled on the existing application target rather than using a second native macOS target. Shared authentication, API access, planner state, offline snapshots and mutation queue, date/carryover logic, Keychain sessions, notifications, and the device-local Apple Reminders store remain the same code paths as iPhone.

Under `targetEnvironment(macCatalyst)`, the app presents a dedicated three-column `NavigationSplitView` interface. Its sidebar separates Week, Events, Plans, Week of Us Tasks, Apple Reminders, Notifications, and Settings. The middle column supports native multi-selection, keyboard navigation, context menus, and drag-to-day rescheduling. Inline inspectors edit Week of Us items, writable calendar events, and due-dated Apple Reminders; switching the selection, day, section, or week with unsaved edits requires an explicit discard. Navigation, day, inspector selection, and column visibility restore across launches for each signed-in Week of Us user.

The File and Week of Us menus provide context-aware Command-N, Command-F, Command-R, Command-S, Command-Return, Delete, and Command-comma actions. Command-F searches plans, tasks, and calendar events across weeks with type and date filters. Command-comma opens a separate Settings window while the sidebar Settings destination remains available. New Apple Reminders accept title, selected writable list, due date/time, notes, URL, priority, and daily, weekly, monthly, or yearly recurrence. Recurrence can use a custom interval, weekly day selection, and a date- or occurrence-based end. Existing reminders can also move between selected writable lists from a context menu while preserving any existing recurrence schedule.

The selected-day strip on Mac displays household or per-person locations and forecasts, opens the shared location search/assignment flow, and provides the full hourly forecast. Notification authorization, token sync, inbox refresh, and badge count are reconciled whenever the Mac app becomes active. In addition to the discretionary system background task, an active Mac app refreshes its planner and forecast snapshot every 15 minutes as a fallback to live household updates.

Week of Us tasks remain supported. An individual task can be explicitly moved to a selected writable Apple Reminders list from its editor or Mac inspector. The flow always creates a due-dated local Reminder before asking the server to delete the shared source task, warns that household deletion is irreversible, and retains the source if deletion fails. It never uploads Reminder contents or identifiers. This is an opt-in per-task retirement path, not an automatic household-wide migration.

Undated Reminder views, an Inbox/All Reminders screen, and Reminder-list creation remain intentionally out of scope.

## Authentication

Sign-in starts the existing Google OAuth flow in `ASWebAuthenticationSession`. The server returns a five-minute, one-use authorization code through the `commonweek://auth` callback. The app exchanges that code and its original random state for a 30-day opaque session token, which is stored in Keychain and sent as a Bearer credential.

After sign-in, Settings can connect or reconnect Google Calendar, request the separate editing permission, refresh calendar discovery, manage each calendar's Hide, Private, Share, alias, badge, and planner-section settings, and configure notification delivery without leaving the app. The iPhone planner retains its four native views: Calendar combines events, plans, and tasks for one day at a time; Events lists the full week's calendar events by day; Plans and Tasks show their whole-week items followed by every day's matching items. Calendar search, RSVP, reminders, and recurring occurrence-or-series controls are native as well. Existing events can move between writable calendars on the same Google connection; recurring events must be edited as an entire series before moving. Google tokens and database credentials remain server-side.

Apple Reminders is an optional, device-local task source. After granting full Reminders access, each signed-in user selects the lists to show and can choose Week of Us or a writable selected list as the default destination for new daily tasks. Only reminders with due dates appear. Open overdue reminders use the same carry-forward placement and label as native daily tasks without changing their Apple due date. Weekly quick-add always creates a Week of Us task. Apple reminders can be completed or reopened, and reminders on writable lists can be renamed, moved between selected writable lists, rescheduled, prioritized, annotated, linked, or deleted. New reminders can define a repeat schedule; editing an existing recurring reminder preserves its current repeat schedule. Deleting one requires an explicit confirmation because it removes the recurring series rather than only the visible reminder. No Apple Reminders data is uploaded to the server or displayed on the web.

For push delivery, enable Push Notifications for `com.jimgreco.commonweek` and use a provisioning profile containing `aps-environment`. The app requests notification permission only when the user enables push, registers the APNs token with the server, and keeps the token associated with the signed-in account.

## Offline and live synchronization

The app stores account-isolated planner snapshots in Application Support with iOS file protection and excludes them from device backups. Plans, tasks, completion changes, deletion, and saved or searched location assignments are applied immediately and queued durably when the network is unavailable. The queue replays automatically on foregrounding, pull-to-refresh, a live household change, or an iOS background refresh. Native-created item IDs and idempotent deletion make replay safe when the server applied a request but its response was lost.

The same household-scoped PostgreSQL event stream used by the website accepts the native Bearer session and refreshes the visible week after another member changes it. iOS and Mac Catalyst schedule `com.jimgreco.commonweek.refresh` with `BGAppRefreshTask`; execution time remains discretionary under the operating system. While the Mac app is active, a 15-minute refresh cadence keeps planner, location, and forecast snapshots current if the event stream is interrupted. Google Calendar create, edit, delete, and hide operations intentionally remain online-only because replaying a stale provider ETag could overwrite a newer Google-side change.

Before using real sign-in, deploy migration `006_native_auth.sql` and the matching Next.js routes. Google still redirects to the existing HTTPS `/auth/callback`; no new Google Console callback is required.

## Verification

```bash
cd ios
xcodegen generate

xcodebuild -project CommonWeek.xcodeproj \
  -scheme CommonWeek \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  test

xcodebuild -project CommonWeek.xcodeproj \
  -scheme CommonWeek \
  -destination 'platform=macOS,variant=Mac Catalyst' \
  build

xcodebuild -project CommonWeek.xcodeproj \
  -scheme CommonWeekScreenshots \
  -destination 'platform=macOS,variant=Mac Catalyst' \
  -only-testing:CommonWeekScreenshots/CommonWeekScreenshots/testMacPlannerShellNavigationAndUnsavedEditProtection \
  test
```

The app targets iOS 26 and the bundle identifier is `com.jimgreco.commonweek` on both iPhone and Mac Catalyst.

## Signed Mac acceptance checklist

EventKit and system permission behavior must be checked with a development-signed Catalyst build on a real Mac:

- Sign in, quit, and relaunch; confirm the Keychain session restores without another login.
- Switch sidebar sections, weeks, days, and inspector items; relaunch and confirm the last navigation state and split-view visibility restore. Resize and relaunch the window to confirm macOS restores its frame.
- Edit a Week of Us task, plan, Reminder, and writable calendar event without saving; confirm every selection/week/section change offers Keep Editing or Discard Changes. Confirm Command-S saves and clears the Edited status.
- Verify Command-N, Command-F, Command-R, Command-S, Command-Return, Delete, and Command-comma in their applicable sections. Confirm unavailable actions are disabled.
- Search for past and upcoming plans, tasks, and events outside the loaded week; open each result and confirm the correct week and inspector load.
- Open the separate Settings window with Command-comma and confirm household, Calendar, Reminders, notification, and account controls work there and in sidebar Settings.
- At the initial Reminders prompt, grant full access and verify lists load.
- Deny access, confirm the recovery explanation, open System Settings, grant full access, return to the app, and verify it refreshes.
- Select and deselect Local and iCloud lists; relaunch and confirm the selection remains isolated to the signed-in Week of Us user on that Mac.
- Verify shared writable lists can create reminders with notes, URL, priority, all-day/timed due date, and selected list; edit, context-menu move, drag-reschedule, complete/reopen, and delete them.
- Verify read-only shared lists display a lock and disable all mutations.
- Create and edit all-day and timed due dates; confirm the household timezone and displayed time remain correct.
- Create daily, weekly, monthly, and yearly recurring reminders. Verify custom intervals, weekly day selection, end dates, and occurrence counts in Apple Reminders.
- Confirm undated reminders never appear.
- Edit an existing recurring reminder and confirm its recurrence schedule is unchanged; verify deletion shows the recurring-series warning before removing the full series.
- Move both daily and whole-week Week of Us tasks to writable Apple Reminders lists. Confirm the Reminder is created before the shared source disappears, completed state is preserved, cancellation changes nothing, and a forced server deletion failure retains the source task.
- Make Reminder changes in Apple Reminders or on another synced device and confirm `EKEventStoreChanged` refreshes the visible week.
- Confirm an overdue open reminder appears visually on today with its original due date unchanged.
- Multi-select several Week of Us tasks or writable Reminders and confirm Command-Return completes or reopens the selection. Verify keyboard navigation and row context menus.
- Drag a Week of Us item, writable Reminder, and writable calendar event to another day. Confirm times are preserved, recurring event moves affect only the intended occurrence, and read-only rows reject the operation.
- Enable notifications, foreground the app after an external inbox change, and confirm inbox state and the Dock badge refresh.
- Change household and per-person locations from the selected-day strip, verify day/through-Sunday/week scopes, and open available hourly forecasts in both temperature units.
- Leave the Mac app active for at least 15 minutes with the live stream disconnected and confirm planner/weather data refreshes; background and foreground it and confirm the system refresh request is resubmitted.

## TestFlight releases

Every push to `main` runs the server checks plus iOS simulator and Mac Catalyst unit tests in `.github/workflows/ci.yml`. After those jobs pass, the reusable `.github/workflows/testflight.yml` creates separate signed iPhone and Mac Catalyst archives, validates both exported packages, and uploads both packages from that exact commit to TestFlight. A manually dispatched CI run on `main` follows the same release path. The Mac archive uses `generic/platform=macOS,variant=Mac Catalyst`; it does not expose the phone-shaped iOS build through the Apple-silicon compatibility setting.

Configure these GitHub Actions secrets before the first release:

- `APPLE_TEAM_ID`
- `IOS_DIST_CERT_P12` — base64-encoded Apple Distribution `.p12`, used to sign both app archives
- `IOS_DIST_CERT_PASSWORD`
- `MAC_INSTALLER_CERT_P12` — base64-encoded Mac Installer Distribution `.p12`, used to sign the exported Catalyst package
- `MAC_INSTALLER_CERT_PASSWORD`
- `KEYCHAIN_PASSWORD`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_API_KEY` — PEM text or base64-encoded PEM

The workflow creates or downloads separate `IOS_APP_STORE` and `MAC_CATALYST_APP_STORE` provisioning profiles for `com.jimgreco.commonweek` through the App Store Connect API. It stops if a named profile exists with the wrong type or is no longer active, and verifies the application identifier, Sign in with Apple, and production APNs entitlements before archiving.

The server deployment also requires `COMMON_WEEK_RESEND_API_KEY`, both email-from secrets, and a dedicated `COMMON_WEEK_APNS_KEY_ID` / `COMMON_WEEK_APNS_PRIVATE_KEY_BASE64` pair.

Before the first Mac upload, use **Add Platform** on the existing Week of Us App Store Connect record to add macOS with version `1.1`; do not create a second app record or bundle identifier. Complete the Mac TestFlight description, feedback contact, export-compliance response, and tester-group assignment there. The first external Mac build may require TestFlight App Review; internal testers can use a processed build immediately after it is assigned to their group.

The optional repository variable `IOS_API_BASE_URL` can override the production API URL. Release validation requires the canonical `https://weekofus.com` origin.

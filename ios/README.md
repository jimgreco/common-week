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

After sign-in, iPhone Settings can connect or reconnect Google Calendar, request the separate editing permission, refresh calendar discovery, and manage each calendar's Hide, Private, Share, alias, badge, and planner-section settings without leaving the app. Google tokens and database credentials remain server-side.

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

App Store Connect must also contain a Week of Us app record for `com.jimgreco.commonweek`, and the provisioning profile must be an active App Store distribution profile for that identifier.

The optional repository variable `IOS_API_BASE_URL` can override the production API URL. Release validation requires the canonical `https://weekofus.com` origin.

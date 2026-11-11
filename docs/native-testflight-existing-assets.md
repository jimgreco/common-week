# Existing-assets-only iOS TestFlight release

Every push to `main` that passes `verify.yml` uploads one iOS build (app plus widgets extension) and one Mac Catalyst build to the existing App Store Connect record, in two parallel jobs. Both use the same Git-count build number, source SHA and marketing version, on the IOS and MAC_OS version trains. `.github/release/release-policy.json` pins the existing profile UUIDs and public certificate fingerprint, app identity, production origin, marketing version, and Jim-only internal audience verified on 2026-10-03. Empty existing groups are allowed only as explicitly listed. Every Apple preflight request is GET. Missing or changed signing assets, audience, build history, or authentication stop the release; they never trigger account repair.

The workflow imports this repository's existing signing identity into a temporary runner keychain. It downloads the pinned existing profiles, verifies live certificate/profile resources and decoded entitlements, preserves any cached profile with the same UUID, and signs/exports manually without provisioning-update flags. Export produces an App Store-eligible build (not TestFlight internal-only), so a processed build can be distributed to internal testers and later selected for an App Store version. It preserves the exact Git-count build number, and embeds the full source SHA. The exported app and all approved extensions must match the expected source, build, version, platform, signing identity, profiles, and required entitlements. Current signing state, audience, and build availability are rechecked immediately before the sole binary upload.

Ownership was cleared on 2026-10-03. Main pushes automatically run the guarded iOS upload path. Any new commit changes the source SHA and Git-count build, and the workflow rechecks current signing state, approved audience, and build availability before upload. A manual run of the **Release** workflow on `main` with `ios` selected also uploads.

## Local checks

The release guards, signing and upload steps are the shared `ios/prepare`, `ios/upload` and `ios/cleanup` actions from [`jimgreco/release-tools`](https://github.com/jimgreco/release-tools), pinned by commit in `testflight.yml` (iOS and Mac Catalyst jobs; see its `ios/README.md`). This repository keeps only the policy, `.github/release/release-policy.json`, and the step that sets the production `API_BASE_URL`. The engine's tests run in release-tools CI. Locally:

```sh
python3 <release-tools>/ios/scripts/verify-release.py validate-policy --policy .github/release/release-policy.json
node <release-tools>/ios/scripts/asc-readonly.mjs validate-policy --policy .github/release/release-policy.json
actionlint .github/workflows/testflight.yml
git diff --check
```

The engine's tests use synthetic in-memory responses and temporary files. They neither read real private keys nor contact Apple. Passing these tests does not prove current Apple validity, accepted version-train status, successful signing, successful upload, tester availability, or device acceptance. The actual authenticated GET checks and final artifact verification must pass during release. A successful uploader response is followed by a separate processing/internal-group availability check; if that times out, inspect the existing Apple build before retrying.

## Authentication and scope

Use only this app's existing configured credentials. Do not create profiles, certificates, capabilities, testers, public links, or API access, copy another app's secrets, accept new terms, change groups, submit App Store metadata, or submit for App Store review. If Apple requests any such action, stop the affected release and report that exact prerequisite. No server deployment is part of this native workflow change.

The Mac job signs with the same pinned Apple Distribution identity and the pinned `Week of Us Mac Catalyst App Store 20260908` profile (`macProfiles` in `release-policy.json`), and signs the package with the existing `MAC_INSTALLER_CERT_P12` installer identity, which must be the only installer identity for team V6JPQCD336. The package must contain one sandboxed app with no extensions (widgets are iOS-only), the pinned profile, production push, Sign in with Apple, the shared App Group and the source stamp. As for iOS, export uses no provisioning updates, and processing must report `APP_STORE_ELIGIBLE`. Builds are never submitted for App Store review automatically; choose a processed build for an App Store version in App Store Connect.

If upload succeeds but Apple processing verification stops, run the manual **Verify existing TestFlight build** workflow with the exact uploaded build number and full original source SHA. It authenticates with this app’s existing API configuration and makes GET requests only; it has no signing or upload step. It verifies source ancestry/count and the same pinned app, audience, App Store-eligible processing and group availability. Do not rerun the upload to check processing.

The app-level tester directory includes one explicitly pinned historical record outside all current groups. That record is not an authorized recipient. Its ID, identity hash and EMAIL invitation type must remain unchanged; the exact complete group set must still give access only to Jim through Internal Testers, with External empty. Every new uploaded build must have no individual testers and must attach to the approved internal group. No group or tester assignment is written by this workflow. This follows Apple's distinction between historical app testers and per-group/per-build access; automatic Xcode distribution applies to current group members.

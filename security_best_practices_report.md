# Week of Us security review

## Executive summary

The local-PostgreSQL refactor has no known Critical or High application-code finding after remediation. Authentication, session, SQL, provider-token, browser, and deployment boundaries were reviewed against the Next.js/React security guidance. The remaining work is two Medium production-operations controls and two Low defense-in-depth improvements; none requires weakening the current product.

Reviewed scope: Next.js 16.3, React 19, TypeScript, Google OAuth/Calendar, PostgreSQL schema and queries, provider requests, Docker image, GitHub Actions, and the consolidated Compose service.

## Resolved controls

- Google OAuth uses an unpredictable state cookie, PKCE S256, fixed canonical callback, ID-token audience verification, and verified email checks (`src/app/auth/callback/route.ts:16-57`).
- Sessions use random 256-bit opaque tokens, store only SHA-256 hashes, expire after 30 days, and use HTTP-only, SameSite Lax, path-scoped cookies that follow the configured HTTPS origin (`src/lib/server/session.ts:9-76`).
- Google access and refresh tokens use AES-256-GCM with random IVs before database storage (`src/lib/server/token-crypto.ts:7-33`).
- All reviewed planning mutations validate runtime input, derive household identity from the server session, parameterize SQL, and include household/resource predicates (`src/app/actions/planner.ts:85-258`).
- PostgreSQL runs under the dedicated `common_week_app` login and separate `common_week` database, not the shared administrator login (`../deploy/docker-compose.yml:156-172`).
- Realtime requires an authenticated household and uses one shared PostgreSQL listener per app process, preventing browser streams from exhausting the main query pool (`src/app/api/realtime/route.ts:8-49`, `src/lib/server/realtime.ts:1-75`).
- The browser receives no database/provider secret. Server modules use `server-only`, and the CSP blocks arbitrary script/connect origins (`src/lib/server/database.ts:1-59`, `src/proxy.ts:6-43`).
- CI uses reproducible installs, audits the production build, migrates real PostgreSQL, and runs explicit cross-household tests (`.github/workflows/ci.yml:15-52`, `scripts/test-database.mjs:1-129`).

## Medium findings

### CW-SEC-001 — Verify rate limiting for public OAuth routes

- Rule ID: NEXT-DOS-001
- Severity: Medium
- Location: `src/app/auth/google/route.ts:12-21`, `src/app/auth/callback/route.ts:34-128`, `docs/DEPLOYMENT.md:43`
- Evidence: Both OAuth handlers are intentionally public. The repository documents Nginx Proxy Manager but does not contain a checked-in rate-limit policy for these paths.
- Impact: Automated traffic can consume application connections/CPU and generate unnecessary requests to Google's authorization service.
- Fix: Configure a conservative per-IP request limit for `/auth/google` and `/auth/callback` in the public reverse proxy, with normal OAuth redirects still allowed.
- Mitigation: The callback requires a matching HTTP-only state cookie and PKCE verifier before token exchange; Google also applies upstream abuse controls.
- False positive notes: The production proxy may already have an access list or rate rule not represented in this repository. Verify it live before closure.

### CW-SEC-002 — Establish encrypted PostgreSQL backups and a restore drill

- Rule ID: availability / durable-storage control
- Severity: Medium
- Location: `../deploy/docker-compose.yml:12-14`, `docs/DEPLOYMENT.md:49-57`
- Evidence: PostgreSQL data is persisted to the server volume, but no checked-in backup schedule, off-host encrypted target, retention policy, or restore test is visible.
- Impact: Host, volume, or operator failure could permanently remove household plans and stored configuration.
- Fix: Add scheduled encrypted `pg_dump` backups for `common_week` to off-host storage, define retention, and test restoration into a disposable database.
- Mitigation: The database already has a persistent host volume and migrations can reconstruct schema, but not household data.
- False positive notes: An infrastructure-level snapshot/backup system may exist outside this repository. Confirm recovery point and restore evidence.

## Low findings

### CW-SEC-003 — Add database-native row isolation if the data plane expands

- Rule ID: defense-in-depth authorization
- Severity: Low
- Location: `src/app/actions/planner.ts:85-258`, `src/app/actions/settings.ts:20-194`, `scripts/test-database.mjs:1-129`
- Evidence: Supabase RLS was removed with the Supabase browser data plane. Authorization is now enforced by the server data-access layer and its household-scoped predicates; PostgreSQL itself does not receive per-request user identity.
- Impact: A future server query that omits the required household predicate would not be independently blocked by a database policy.
- Fix: If a generic API, additional service, or direct client data plane is added, introduce a non-owner runtime role plus transaction-local identity and forced PostgreSQL RLS policies before launch.
- Mitigation: Today the browser cannot query PostgreSQL, every reviewed query is server-only, the runtime uses a separate database/login, and real-PostgreSQL CI tests cross-household IDs.
- False positive notes: This is not a current direct-access bypass; it is a future-regression defense.

### CW-SEC-004 — Token-encryption key rotation requires reconnect or migration

- Rule ID: secret lifecycle
- Severity: Low
- Location: `src/lib/server/token-crypto.ts:5-33`, `docs/DEPLOYMENT.md:28-35`
- Evidence: Ciphertexts carry a format version, but the runtime accepts only the single current `GOOGLE_TOKEN_ENCRYPTION_KEY`.
- Impact: Replacing that key without first re-encrypting stored tokens makes existing Google connections unreadable and requires both members to reconnect.
- Fix: Before routine rotation is needed, add a key identifier/keyring and an online re-encryption migration.
- Mitigation: The key is generated server-side, never browser-exposed, and reconnecting safely replaces the encrypted credentials.
- False positive notes: V1 has one household and no scheduled rotation requirement; reconnect is an acceptable recovery path today.

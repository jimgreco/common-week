# Security best-practices review

Reviewed: 2026-08-10  
Scope: Next.js/React/TypeScript application, Supabase schema and RLS, Google OAuth/Calendar integration, Open-Meteo integrations, dependency tree, and deployment configuration.

## Outcome

No open critical or high-severity source findings remain. `npm audit` reports zero known vulnerabilities in both production and full dependency trees. The review did identify and fix an ownership-column privilege issue and revoked-token cleanup behavior before completion.

Production release is still gated on applying the migration to a disposable Supabase project and running a real three-account isolation exercise. Docker was not running in this environment, so the included pgTAP database test could not be executed locally.

## Open findings

### SEC-LOW-01 — OAuth refresh tokens rely on database and service-role protection

**Severity:** Low  
**Location:** `supabase/migrations/202608100001_initial_family_planner.sql:122-131`, `src/lib/supabase/admin.ts:1-15`

Google access and refresh tokens are stored as text columns. Browser roles have no table privileges, RLS is enabled, and the service-role client is poisoned as server-only, so this is not a client exposure. A database backup or service-role compromise would nevertheless expose reusable refresh tokens.

**Recommendation:** Before a higher-risk or multi-tenant launch, envelope-encrypt refresh tokens using a managed KMS or a carefully designed Supabase Vault/RPC boundary. Rotate the Supabase service-role key if it is ever exposed, and revoke affected Google grants.

### SEC-LOW-02 — CSP permits inline styles

**Severity:** Low  
**Location:** `src/proxy.ts:15-27`

The production script policy uses a per-request nonce and `strict-dynamic`, but `style-src` includes `unsafe-inline` because the UI uses React style attributes for calendar colors and weather chart heights. No user-controlled HTML or CSS sink was found, so the practical risk is limited.

**Recommendation:** If the UI later renders rich text or other untrusted markup, remove inline-style requirements first and tighten `style-src`; do not add HTML bypasses such as `dangerouslySetInnerHTML`.

## Resolved during review

### SEC-HIGH-01 — Immutable planning-item ownership columns

The migration now revokes table-level `UPDATE` from `authenticated` and grants only the mutable columns (`planning_date`, week, type, category, text, completion, and order). This prevents a client from changing `household_id`, `created_by`, `created_at`, or `updated_at`, even in deployments whose default grants include table-level update. See `supabase/migrations/202608100001_initial_family_planner.sql:477-481`.

### SEC-MED-01 — Revoked Google credentials

A genuine Google 401 now deletes that user's server-side connection and returns a Calendar-only disconnected state. It does not repeatedly reuse a revoked credential or break planning/weather. See `src/lib/server/calendar-data.ts:146-151`.

### SEC-MED-02 — OAuth callback redirect validation

The callback accepts only local absolute paths and rejects protocol-relative paths and backslashes, preventing an OAuth open redirect. See `src/app/auth/callback/route.ts:5-7` and `:57-58`.

## Verified controls

- OAuth requests the read-only Calendar scope and no Calendar write scope (`src/app/actions/auth.ts:14-25`).
- Server Actions validate length, type, UUID, Monday boundary, and date-in-week constraints, then derive `user_id` and `household_id` from the authenticated server context (`src/app/actions/planner.ts:61-100`).
- All household tables have RLS; browser grants are explicit and narrow, while locations, daily settings, planning items, invitations, calendar preferences, and weather cache require membership or ownership checks (`supabase/migrations/202608100001_initial_family_planner.sql:329-475`).
- OAuth and calendar cache tables are explicitly inaccessible to browser roles (`supabase/migrations/202608100001_initial_family_planner.sql:477-478`).
- Security-definer household functions use an empty `search_path`, reject unauthenticated callers internally, and revoke execution from public/anonymous roles (`supabase/migrations/202608100001_initial_family_planner.sql:224-317`).
- The Supabase service-role key and Google client secret are documented only as server variables; none use the `NEXT_PUBLIC_` prefix (`.env.example:1-11`).
- External requests use fixed provider origins, timeouts, and normalized response types. User input changes query parameters, not request origins.
- The response proxy sets CSP, frame denial, MIME-sniffing prevention, referrer policy, permissions policy, and HTTPS upgrade (`src/proxy.ts:30-43`).
- Server Action bodies are capped at 256 KB and the framework signature is suppressed (`next.config.ts:3-9`).
- No `dangerouslySetInnerHTML`, dynamic code evaluation, browser-side service-role import, or client-provided household/user identity trust was found.

## Required live security checks

1. Apply the migration to a disposable Supabase project and run `npx supabase test db`.
2. Create household A with two accounts and household B with a third account.
3. Using the third account's authenticated client, attempt select/insert/update/delete against every household-scoped table and verify zero cross-household disclosure or mutation.
4. Confirm browser network responses and built JavaScript contain no service-role key, Google client secret, access token, or refresh token.
5. Revoke one member's Google grant and verify only their Calendar source disconnects.
6. Verify production headers and OAuth redirect allow lists on the final Vercel domain.

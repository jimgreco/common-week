# Deployment

## Consolidated EC2 server

Every push to `main` runs `.github/workflows/deploy.yml`. The workflow:

1. Runs lint, TypeScript, Vitest, a real PostgreSQL migration/isolation test, and the production build.
2. Builds an ARM64 image and publishes exact-commit plus `latest` tags to GitHub Container Registry.
3. Connects to the shared server and uses the canonical `common-week` service in `~/deploy/docker-compose.yml`.
4. Starts the existing `db` service, creates the dedicated `common_week_app` login and `common_week` database if absent, and runs application migrations from the exact image.
5. Restarts Common Week and requires `/api/health` to report the exact Git SHA and a ready PostgreSQL connection.
6. Checks the public endpoint when `PRODUCTION_BASE_URL` is configured.

The service uses the `common-week` Compose profile so an unrelated infrastructure deployment does not replace the application image pinned by its own workflow. It uses the same PostgreSQL container as the other server apps but a separate database and restricted login. DynamoDB is not used.

Configure these GitHub Actions secrets at the repository level or in the `production` environment:

- `EC2_HOST`
- `EC2_USER`
- `EC2_SSH_KEY`
- `COMMON_WEEK_GOOGLE_CLIENT_ID`
- `COMMON_WEEK_GOOGLE_CLIENT_SECRET`

Set the Actions variable:

```text
PRODUCTION_BASE_URL=https://common-week.jim-greco.com
```

The deployment transfers the Google credentials through a permission-restricted temporary file, updates `~/deploy/.env`, and removes the temporary copy. The first application deployment also generates `COMMON_WEEK_DB_PASSWORD` and `COMMON_WEEK_GOOGLE_TOKEN_ENCRYPTION_KEY` directly in that protected server file. The remaining runtime values are:

```dotenv
COMMON_WEEK_APP_URL=https://common-week.jim-greco.com
COMMON_WEEK_ENABLE_DEMO=false
```

Do not copy another app's OAuth client unless its Google configuration intentionally includes Common Week's callback. The authorized production redirect URI must be:

```text
https://common-week.jim-greco.com/auth/callback
```

In Nginx Proxy Manager, create a TLS proxy host for the canonical hostname with upstream `http://common-week:3000`. Keep the proxy on the shared Compose network. Server-sent events send `X-Accel-Buffering: no`; preserve streaming through the proxy for immediate collaboration updates.

## Vercel note

The application remains build-compatible with Vercel, but the chosen production database is private on the consolidated EC2 Compose network. A Vercel deployment would need secure network access to that database or a separate managed PostgreSQL instance. The canonical deployment path is therefore the existing EC2 server.

## Post-deploy verification

- Confirm `/api/health` reports `status: ok`, the deployed commit, and `database: ready`.
- Confirm `/` offers Google sign-in after credentials are configured.
- Complete the two-member and third-account isolation checks in [SETUP.md](SETUP.md).
- Inspect response headers for CSP, frame denial, MIME-sniffing prevention, referrer policy, and permissions policy.
- Confirm database and Google secrets are absent from browser JavaScript.
- Test `/planner` at 1440px, 390px, and 320px widths.
- Confirm Calendar or weather interruption does not prevent planning-item use.

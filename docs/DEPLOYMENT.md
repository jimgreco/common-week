# Deployment

## Consolidated EC2 server

Every push to `main` runs `.github/workflows/deploy.yml`. After application checks pass, the workflow builds an ARM64 production image on GitHub's runner, publishes that exact commit image to GitHub Container Registry, syncs the Compose overlay to `~/common-week`, pulls the image into the existing `~/deploy` stack, and verifies that `/api/health` reports the exact pushed commit. The shared host never performs the resource-intensive Next.js image build.

Create a `production` GitHub environment and add these repository or environment secrets:

- `EC2_HOST`
- `EC2_USER`
- `EC2_SSH_KEY`

The service starts in demo mode when no application credentials are configured. For a real household, add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` as GitHub `production` environment secrets, and set `NEXT_PUBLIC_ENABLE_DEMO=false` as an environment variable. These public values must be available when the image is built because Next.js inlines `NEXT_PUBLIC_` values.

Add the corresponding runtime configuration to `~/deploy/.env` on the server:

```dotenv
COMMON_WEEK_APP_URL=https://common-week.jim-greco.com
COMMON_WEEK_ENABLE_DEMO=false
COMMON_WEEK_SUPABASE_URL=
COMMON_WEEK_SUPABASE_PUBLISHABLE_KEY=
COMMON_WEEK_SUPABASE_SERVICE_ROLE_KEY=
COMMON_WEEK_GOOGLE_CLIENT_ID=
COMMON_WEEK_GOOGLE_CLIENT_SECRET=
```

Keep the two public Supabase entries aligned with the GitHub environment values. The service-role and Google client secrets remain runtime-only container values.

In Nginx Proxy Manager, create a proxy host for the canonical hostname with upstream `http://common-week:3000`, enable TLS, and keep the proxy on the shared Compose network. Set the GitHub Actions variable `PRODUCTION_BASE_URL` to that `https://` origin so deployments also verify the public route. Until DNS and the proxy host exist, the workflow still verifies the container from inside the shared server.

## Vercel

## Before deploying

1. Complete [Supabase and Google setup](SETUP.md).
2. Push this repository to a private Git provider repository.
3. Import the project into Vercel as a Next.js project.
4. Add every variable from `.env.example` for Production and Preview as appropriate. Use a different Supabase project for preview if preview data must be isolated.
5. Set `NEXT_PUBLIC_APP_URL` to the canonical production origin, for example `https://planner.example.com`.
6. Update the Supabase Site URL/redirect allow list and Google OAuth configuration for that canonical origin.

Do not expose `SUPABASE_SERVICE_ROLE_KEY` or `GOOGLE_CLIENT_SECRET` as `NEXT_PUBLIC_` variables.

## Build and deploy

Vercel detects Next.js automatically. The production build command is:

```bash
npm run build
```

The CI workflow runs lint, TypeScript, Vitest, and the production build on pull requests and `main` pushes.

## Post-deploy verification

- Confirm `/` signs in and `/auth/callback` returns only to an allow-listed relative path.
- Inspect response headers for Content Security Policy, frame denial, MIME sniffing prevention, referrer policy, and permissions policy.
- Complete the two-member and third-account isolation checks in [SETUP.md](SETUP.md).
- Confirm all server-only environment variables are present in Production and absent from the browser bundle.
- Test `/planner` at 1440px, 390px, and 320px widths.
- Confirm Calendar or weather provider interruption does not prevent planning-item use.

The app intentionally opts out of search indexing because it is a private household tool.

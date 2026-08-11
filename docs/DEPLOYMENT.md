# Deploy to Vercel

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

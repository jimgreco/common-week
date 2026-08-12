import "server-only";

import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import { applicationOrigin, shouldUseSecureCookies } from "@/lib/env";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
] as const;

export const OAUTH_STATE_COOKIE = "common_week_oauth_state";
export const OAUTH_VERIFIER_COOKIE = "common_week_oauth_verifier";

export function googleOAuthClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth is not configured.");
  return new OAuth2Client({
    clientId,
    clientSecret,
    redirectUri: `${applicationOrigin()}/auth/callback`,
  });
}

export async function createGoogleAuthorization() {
  const client = googleOAuthClient();
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const state = crypto.randomUUID();
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: true,
    scope: [...GOOGLE_SCOPES],
    state,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });
  return { url, state, codeVerifier };
}

export function oauthCookieOptions() {
  return {
    httpOnly: true,
    secure: shouldUseSecureCookies(),
    sameSite: "lax" as const,
    path: "/",
    maxAge: 10 * 60,
    priority: "high" as const,
  };
}

import "server-only";

import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import { applicationOrigin, shouldUseSecureCookies } from "@/lib/env";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
] as const;

export const GOOGLE_CALENDAR_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export const OAUTH_STATE_COOKIE = "common_week_oauth_state";
export const OAUTH_VERIFIER_COOKIE = "common_week_oauth_verifier";
export const OAUTH_MODE_COOKIE = "common_week_oauth_mode";
export const OAUTH_PLATFORM_COOKIE = "common_week_oauth_platform";
export const OAUTH_CLIENT_STATE_COOKIE = "common_week_oauth_client_state";
export const OAUTH_CONNECT_COOKIE = "common_week_oauth_connect";

export function hasGoogleScope(scope: string | null | undefined, expected: string): boolean {
  return new Set((scope ?? "").split(/\s+/).filter(Boolean)).has(expected);
}

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

export async function createGoogleAuthorization(options: { calendarWrite?: boolean } = {}) {
  const client = googleOAuthClient();
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const state = crypto.randomUUID();
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: true,
    scope: options.calendarWrite ? [...GOOGLE_SCOPES, GOOGLE_CALENDAR_WRITE_SCOPE] : [...GOOGLE_SCOPES],
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

import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { applicationOrigin } from "@/lib/env";
import { acceptPendingInvitation, findOrCreateProviderUser } from "@/lib/server/account-identity";
import { refreshCurrentUserCalendarPreferences } from "@/lib/server/calendar-data";
import { withTransaction } from "@/lib/server/database";
import {
  GOOGLE_CALENDAR_WRITE_SCOPE,
  GOOGLE_SCOPES,
  googleOAuthClient,
  OAUTH_CLIENT_STATE_COOKIE,
  OAUTH_CONNECT_COOKIE,
  OAUTH_MODE_COOKIE,
  OAUTH_PLATFORM_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
} from "@/lib/server/google-oauth";
import { createDatabaseSession, createNativeAuthorizationCode, SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/session";
import { consumeNativeConnectionCode } from "@/lib/server/session";
import { encryptProviderToken } from "@/lib/server/token-crypto";

export const runtime = "nodejs";

function equalState(expected: string | undefined, actual: string | null): boolean {
  if (!expected || !actual) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

function clearOAuthCookies(response: NextResponse) {
  response.cookies.delete(OAUTH_STATE_COOKIE);
  response.cookies.delete(OAUTH_VERIFIER_COOKIE);
  response.cookies.delete(OAUTH_MODE_COOKIE);
  response.cookies.delete(OAUTH_PLATFORM_COOKIE);
  response.cookies.delete(OAUTH_CLIENT_STATE_COOKIE);
  response.cookies.delete(OAUTH_CONNECT_COOKIE);
}

function authFailure(reason: string, platform?: string, clientState?: string) {
  const destination = platform === "ios" && clientState
    ? (() => {
        const callback = new URL("commonweek://auth");
        callback.searchParams.set("error", reason);
        callback.searchParams.set("state", clientState);
        return callback;
      })()
    : new URL(`/?auth_error=${encodeURIComponent(reason)}`, applicationOrigin());
  const response = NextResponse.redirect(destination);
  clearOAuthCookies(response);
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const codeVerifier = request.cookies.get(OAUTH_VERIFIER_COOKIE)?.value;
  const oauthMode = request.cookies.get(OAUTH_MODE_COOKIE)?.value;
  const oauthPlatform = request.cookies.get(OAUTH_PLATFORM_COOKIE)?.value;
  const clientState = request.cookies.get(OAUTH_CLIENT_STATE_COOKIE)?.value;
  const connectToken = request.cookies.get(OAUTH_CONNECT_COOKIE)?.value;
  if (!code || !codeVerifier || !equalState(expectedState, state)) return authFailure("state", oauthPlatform, clientState);

  try {
    const client = googleOAuthClient();
    const { tokens } = await client.getToken({ code, codeVerifier });
    if (!tokens.id_token || !tokens.access_token) throw new Error("Google did not return the required credentials.");
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      throw new Error("Google did not return a verified identity.");
    }

    const email = payload.email.toLowerCase();
    const displayName = (payload.name || email.split("@")[0] || "Family member").slice(0, 120);
    const accessToken = encryptProviderToken(tokens.access_token);
    const refreshToken = tokens.refresh_token ? encryptProviderToken(tokens.refresh_token) : null;
    const session = await withTransaction(async (database) => {
      const linkedUserId = connectToken && clientState ? await consumeNativeConnectionCode(connectToken, clientState) : null;
      const userId = linkedUserId ?? await findOrCreateProviderUser(database, {
        provider: "google",
        subject: payload.sub,
        email,
        displayName,
        avatarUrl: payload.picture ?? null,
      });
      if (linkedUserId) {
        const existingGoogleIdentity = await database.query<{ user_id: string }>(
          "select user_id from user_identities where provider = 'google' and provider_subject = $1",
          [payload.sub],
        );
        if (existingGoogleIdentity.rows[0] && existingGoogleIdentity.rows[0].user_id !== linkedUserId) {
          throw new Error("That Google account is already connected to another Week of Us account.");
        }
        await database.query(
          `insert into user_identities (user_id, provider, provider_subject) values ($1, 'google', $2)
           on conflict (provider, provider_subject) do nothing`,
          [linkedUserId, payload.sub],
        );
        await database.query("update users set google_subject = $2, updated_at = now() where id = $1", [linkedUserId, payload.sub]);
      }

      await database.query(
        `insert into google_connections (
           user_id, access_token_encrypted, refresh_token_encrypted, expires_at, scope
         ) values ($1, $2, $3, $4, $5)
         on conflict (user_id) do update set
           access_token_encrypted = excluded.access_token_encrypted,
           refresh_token_encrypted = coalesce(excluded.refresh_token_encrypted, google_connections.refresh_token_encrypted),
           expires_at = excluded.expires_at,
           scope = excluded.scope`,
        [
          userId,
          accessToken,
          refreshToken,
          tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 55 * 60_000),
          tokens.scope || [
            ...GOOGLE_SCOPES,
            ...(oauthMode === "calendar-write" ? [GOOGLE_CALENDAR_WRITE_SCOPE] : []),
          ].join(" "),
        ],
      );

      const householdId = await acceptPendingInvitation(database, userId, email);

      const authorization = oauthPlatform === "ios" && clientState
        ? { kind: "native" as const, ...(await createNativeAuthorizationCode(database, userId, clientState)) }
        : { kind: "web" as const, ...(await createDatabaseSession(database, userId)) };
      return { ...authorization, householdId, userId };
    });

    if (oauthMode === "calendar-write" && session.householdId) {
      try {
        await refreshCurrentUserCalendarPreferences(session.householdId, session.userId);
      } catch (error) {
        console.warn("Calendar access roles could not be refreshed after authorization", {
          name: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }

    if (session.kind === "native") {
      if (!clientState) return authFailure("state", oauthPlatform, clientState);
      const callback = new URL("commonweek://auth");
      callback.searchParams.set("code", session.code);
      callback.searchParams.set("state", clientState);
      const response = NextResponse.redirect(callback);
      clearOAuthCookies(response);
      return response;
    }

    const destination = session.householdId
      ? oauthMode === "calendar-write" ? "/settings?calendar_editing=enabled#calendars" : "/planner"
      : "/onboarding";
    const response = NextResponse.redirect(new URL(destination, applicationOrigin()));
    response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expires));
    clearOAuthCookies(response);
    return response;
  } catch (error) {
    console.error("Google OAuth callback failed", error instanceof Error ? error.name : "UnknownError");
    return authFailure("callback", oauthPlatform, clientState);
  }
}

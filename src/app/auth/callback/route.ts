import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { applicationOrigin } from "@/lib/env";
import { withTransaction } from "@/lib/server/database";
import {
  GOOGLE_SCOPES,
  googleOAuthClient,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
} from "@/lib/server/google-oauth";
import { createDatabaseSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/session";
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
}

function authFailure(reason: string) {
  const response = NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(reason)}`, applicationOrigin()));
  clearOAuthCookies(response);
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const codeVerifier = request.cookies.get(OAUTH_VERIFIER_COOKIE)?.value;
  if (!code || !codeVerifier || !equalState(expectedState, state)) return authFailure("state");

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
      const userResult = await database.query<{ id: string }>(
        `insert into users (google_subject, email, display_name, avatar_url)
         values ($1, $2, $3, $4)
         on conflict (google_subject) do update set
           email = excluded.email,
           display_name = excluded.display_name,
           avatar_url = excluded.avatar_url
         returning id`,
        [payload.sub, email, displayName, payload.picture ?? null],
      );
      const userId = userResult.rows[0].id;

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
          tokens.scope || GOOGLE_SCOPES.join(" "),
        ],
      );

      const membership = await database.query<{ household_id: string }>(
        "select household_id from household_members where user_id = $1",
        [userId],
      );
      let householdId = membership.rows[0]?.household_id ?? null;
      if (!householdId) {
        const invitation = await database.query<{ id: string; household_id: string }>(
          `select id, household_id
             from household_invitations
            where email = $1 and status = 'pending' and expires_at > now()
            order by created_at desc
            limit 1
            for update skip locked`,
          [email],
        );
        if (invitation.rows[0]) {
          householdId = invitation.rows[0].household_id;
          await database.query(
            "insert into household_members (household_id, user_id, role) values ($1, $2, 'member')",
            [householdId, userId],
          );
          await database.query(
            "update household_invitations set status = 'accepted', accepted_at = now() where id = $1",
            [invitation.rows[0].id],
          );
        }
      }

      return { ...(await createDatabaseSession(database, userId)), householdId };
    });

    const destination = session.householdId ? "/planner" : "/onboarding";
    const response = NextResponse.redirect(new URL(destination, applicationOrigin()));
    response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expires));
    clearOAuthCookies(response);
    return response;
  } catch (error) {
    console.error("Google OAuth callback failed", error instanceof Error ? error.name : "UnknownError");
    return authFailure("callback");
  }
}

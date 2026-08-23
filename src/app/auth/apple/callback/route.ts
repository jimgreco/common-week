import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { applicationOrigin } from "@/lib/env";
import { acceptPendingInvitation, findOrCreateProviderUser } from "@/lib/server/account-identity";
import { APPLE_NONCE_COOKIE, APPLE_STATE_COOKIE, appleRedirectUri, appleWebClientId, exchangeAppleAuthorizationCode, verifyAppleIdentityToken } from "@/lib/server/apple-auth";
import { withTransaction } from "@/lib/server/database";
import { createDatabaseSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/server/session";
import { encryptProviderToken } from "@/lib/server/token-crypto";

export const runtime = "nodejs";

function equalSecret(expected: string | undefined, actual: string): boolean {
  if (!expected) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

function finish(response: NextResponse) {
  response.cookies.delete(APPLE_STATE_COOKIE);
  response.cookies.delete(APPLE_NONCE_COOKIE);
  return response;
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const code = String(form.get("code") || "");
    const state = String(form.get("state") || "");
    const postedToken = String(form.get("id_token") || "");
    const nonce = request.cookies.get(APPLE_NONCE_COOKIE)?.value;
    if (!code || !postedToken || !nonce || !equalSecret(request.cookies.get(APPLE_STATE_COOKIE)?.value, state)) {
      throw new Error("Apple sign-in state was invalid.");
    }
    const clientId = appleWebClientId();
    const exchanged = await exchangeAppleAuthorizationCode(code, clientId, appleRedirectUri());
    const verified = await verifyAppleIdentityToken(exchanged.identityToken, clientId, nonce);
    const posted = await verifyAppleIdentityToken(postedToken, clientId, nonce);
    if (verified.subject !== posted.subject) throw new Error("Apple identity did not match the authorization code.");

    let submittedName = "";
    const rawUser = form.get("user");
    if (typeof rawUser === "string" && rawUser.length <= 4_000) {
      try {
        const user = JSON.parse(rawUser) as { name?: { firstName?: string; lastName?: string } };
        submittedName = [user.name?.firstName, user.name?.lastName].filter(Boolean).join(" ").trim().slice(0, 120);
      } catch { /* Apple only supplies this once; the verified email remains usable. */ }
    }
    const displayName = submittedName || verified.email.split("@")[0] || "Family member";
    const result = await withTransaction(async (database) => {
      const userId = await findOrCreateProviderUser(database, {
        provider: "apple", subject: verified.subject, email: verified.email, displayName,
      });
      await database.query(
        `insert into apple_connections (user_id, refresh_token_encrypted, client_id)
         values ($1, $2, $3)
         on conflict (user_id) do update set refresh_token_encrypted = excluded.refresh_token_encrypted,
           client_id = excluded.client_id, updated_at = now()`,
        [userId, encryptProviderToken(exchanged.refreshToken), clientId],
      );
      const householdId = await acceptPendingInvitation(database, userId, verified.email);
      return { ...(await createDatabaseSession(database, userId)), householdId };
    });
    const response = NextResponse.redirect(new URL(result.householdId ? "/planner" : "/onboarding", applicationOrigin()), 303);
    response.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions(result.expires));
    return finish(response);
  } catch (error) {
    console.error("Apple OAuth callback failed", error instanceof Error ? error.message : "UnknownError");
    return finish(NextResponse.redirect(new URL("/?auth_error=apple_callback", applicationOrigin()), 303));
  }
}

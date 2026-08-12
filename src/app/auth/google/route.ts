import { NextResponse } from "next/server";
import { applicationOrigin } from "@/lib/env";
import {
  createGoogleAuthorization,
  oauthCookieOptions,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
} from "@/lib/server/google-oauth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const authorization = await createGoogleAuthorization();
    const response = NextResponse.redirect(authorization.url);
    response.cookies.set(OAUTH_STATE_COOKIE, authorization.state, oauthCookieOptions());
    response.cookies.set(OAUTH_VERIFIER_COOKIE, authorization.codeVerifier, oauthCookieOptions());
    return response;
  } catch {
    return NextResponse.redirect(new URL("/?auth_error=configuration", applicationOrigin()));
  }
}

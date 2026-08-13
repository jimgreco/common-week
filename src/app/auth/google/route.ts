import { NextResponse, type NextRequest } from "next/server";
import { applicationOrigin } from "@/lib/env";
import {
  createGoogleAuthorization,
  oauthCookieOptions,
  OAUTH_MODE_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
} from "@/lib/server/google-oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const calendarWrite = request.nextUrl.searchParams.get("calendar_write") === "1";
    const authorization = await createGoogleAuthorization({ calendarWrite });
    const response = NextResponse.redirect(authorization.url);
    response.cookies.set(OAUTH_STATE_COOKIE, authorization.state, oauthCookieOptions());
    response.cookies.set(OAUTH_VERIFIER_COOKIE, authorization.codeVerifier, oauthCookieOptions());
    if (calendarWrite) response.cookies.set(OAUTH_MODE_COOKIE, "calendar-write", oauthCookieOptions());
    return response;
  } catch {
    return NextResponse.redirect(new URL("/?auth_error=configuration", applicationOrigin()));
  }
}

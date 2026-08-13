import { NextResponse, type NextRequest } from "next/server";
import { applicationOrigin } from "@/lib/env";
import {
  createGoogleAuthorization,
  oauthCookieOptions,
  OAUTH_CLIENT_STATE_COOKIE,
  OAUTH_MODE_COOKIE,
  OAUTH_PLATFORM_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
} from "@/lib/server/google-oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const platform = request.nextUrl.searchParams.get("platform");
  const clientState = request.nextUrl.searchParams.get("client_state");
  try {
    const isNative = platform === "ios";
    if (isNative && !clientState?.match(/^[A-Za-z0-9_-]{20,128}$/)) {
      return NextResponse.json({ error: "Invalid native sign-in state." }, { status: 400 });
    }
    const calendarWrite = request.nextUrl.searchParams.get("calendar_write") === "1";
    const authorization = await createGoogleAuthorization({ calendarWrite });
    const response = NextResponse.redirect(authorization.url);
    response.cookies.set(OAUTH_STATE_COOKIE, authorization.state, oauthCookieOptions());
    response.cookies.set(OAUTH_VERIFIER_COOKIE, authorization.codeVerifier, oauthCookieOptions());
    if (calendarWrite) response.cookies.set(OAUTH_MODE_COOKIE, "calendar-write", oauthCookieOptions());
    if (isNative && clientState) {
      response.cookies.set(OAUTH_PLATFORM_COOKIE, "ios", oauthCookieOptions());
      response.cookies.set(OAUTH_CLIENT_STATE_COOKIE, clientState, oauthCookieOptions());
    }
    return response;
  } catch {
    if (platform === "ios" && clientState?.match(/^[A-Za-z0-9_-]{20,128}$/)) {
      const callback = new URL("commonweek://auth");
      callback.searchParams.set("error", "configuration");
      callback.searchParams.set("state", clientState);
      return NextResponse.redirect(callback);
    }
    return NextResponse.redirect(new URL("/?auth_error=configuration", applicationOrigin()));
  }
}

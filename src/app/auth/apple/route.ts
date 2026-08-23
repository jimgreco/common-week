import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { APPLE_NONCE_COOKIE, APPLE_STATE_COOKIE, appleRedirectUri, appleWebClientId } from "@/lib/server/apple-auth";

export const runtime = "nodejs";
export async function GET() {
  try {
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const url = new URL("https://appleid.apple.com/auth/authorize");
    url.search = new URLSearchParams({
      client_id: appleWebClientId(),
      redirect_uri: appleRedirectUri(),
      response_type: "code id_token",
      response_mode: "form_post",
      scope: "name email",
      state,
      nonce,
    }).toString();
    const response = NextResponse.redirect(url);
    const cookieOptions = { httpOnly: true, secure: true, sameSite: "none" as const, path: "/", maxAge: 10 * 60, priority: "high" as const };
    response.cookies.set(APPLE_STATE_COOKIE, state, cookieOptions);
    response.cookies.set(APPLE_NONCE_COOKIE, nonce, cookieOptions);
    return response;
  } catch {
    return NextResponse.redirect(new URL("/?auth_error=apple_configuration", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"));
  }
}

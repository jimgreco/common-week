import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/env", () => ({ applicationOrigin: () => "https://weekofus.invalid" }));
vi.mock("@/lib/server/google-oauth", () => ({
  createGoogleAuthorization: async () => ({ url: "https://accounts.google.com/o/oauth2/auth", state: "new-state", codeVerifier: "new-verifier" }),
  oauthCookieOptions: () => ({ httpOnly: true, secure: true, sameSite: "lax" }),
  OAUTH_STATE_COOKIE: "state", OAUTH_VERIFIER_COOKIE: "verifier", OAUTH_MODE_COOKIE: "mode",
  OAUTH_PLATFORM_COOKIE: "platform", OAUTH_CLIENT_STATE_COOKIE: "client-state", OAUTH_CONNECT_COOKIE: "connect",
}));
import { GET } from "@/app/auth/google/route";

describe("Google OAuth initiation", () => {
  it("clears optional context left by an abandoned native connection before starting web login", async () => {
    const response = await GET(new NextRequest("https://weekofus.invalid/auth/google", {
      headers: { Cookie: "connect=old-link; client-state=old-state; platform=ios; mode=calendar-write" },
    }));
    for (const name of ["connect", "client-state", "platform", "mode"]) {
      expect(response.cookies.get(name)?.value).toBe("");
      const expires = response.cookies.get(name)?.expires;
      expect(expires instanceof Date ? expires.getTime() : expires).toBe(0);
    }
    expect(response.cookies.get("state")?.value).toBe("new-state");
  });
});

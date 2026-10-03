import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), createNativeAuthorizationCode: vi.fn(), consumeNativeConnectionCode: vi.fn(),
  createDatabaseSession: vi.fn(), findOrCreateProviderUser: vi.fn(), acceptPendingInvitation: vi.fn(),
  refreshCurrentUserCalendarPreferences: vi.fn(), getToken: vi.fn(), verifyIdToken: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ applicationOrigin: () => "https://weekofus.invalid" }));
vi.mock("@/lib/server/database", () => ({ withTransaction: async (work: (db: unknown) => unknown) => work({ query: mocks.query }) }));
vi.mock("@/lib/server/account-identity", () => ({
  findOrCreateProviderUser: mocks.findOrCreateProviderUser, acceptPendingInvitation: mocks.acceptPendingInvitation, ensurePersonalHousehold: vi.fn(),
}));
vi.mock("@/lib/server/calendar-data", () => ({ refreshCurrentUserCalendarPreferences: mocks.refreshCurrentUserCalendarPreferences }));
vi.mock("@/lib/server/token-crypto", () => ({ encryptProviderToken: (token: string) => `encrypted:${token}` }));
vi.mock("@/lib/server/session", () => ({
  createNativeAuthorizationCode: mocks.createNativeAuthorizationCode, consumeNativeConnectionCode: mocks.consumeNativeConnectionCode,
  createDatabaseSession: mocks.createDatabaseSession, SESSION_COOKIE: "session", sessionCookieOptions: vi.fn(),
}));
vi.mock("@/lib/server/google-oauth", () => ({
  GOOGLE_CALENDAR_WRITE_SCOPE: "calendar.events", GOOGLE_SCOPES: ["openid"],
  googleOAuthClient: () => ({ getToken: mocks.getToken, verifyIdToken: mocks.verifyIdToken }),
  OAUTH_STATE_COOKIE: "state", OAUTH_VERIFIER_COOKIE: "verifier", OAUTH_MODE_COOKIE: "mode",
  OAUTH_PLATFORM_COOKIE: "platform", OAUTH_CLIENT_STATE_COOKIE: "client-state", OAUTH_CONNECT_COOKIE: "connect",
}));

import { GET } from "@/app/auth/callback/route";

describe("Google connection callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumeNativeConnectionCode.mockResolvedValue("initiating-native-user");
    mocks.createNativeAuthorizationCode.mockResolvedValue({ code: "completion-code", expires: new Date() });
    mocks.getToken.mockResolvedValue({ tokens: { access_token: "synthetic-access", refresh_token: "synthetic-refresh", id_token: "synthetic-id", scope: "openid calendar.events" } });
    mocks.verifyIdToken.mockResolvedValue({ getPayload: () => ({ sub: "google-subject", email: "google@example.invalid", email_verified: true }) });
  });

  function callback() {
    return new NextRequest("https://weekofus.invalid/auth/callback?code=google-code&state=browser-state", {
      headers: { Cookie: "state=browser-state; verifier=pkce-verifier; platform=ios; client-state=native-state; connect=initiation-code; mode=calendar-write" },
    });
  }

  it("stages encrypted credentials without changing identities or connecting Google", async () => {
    const response = await GET(callback());
    expect(response.headers.get("location")).toContain("commonweek://auth?code=completion-code");
    expect(mocks.createNativeAuthorizationCode).toHaveBeenCalledWith(
      expect.anything(), "initiating-native-user", "native-state", expect.objectContaining({
        subject: "google-subject", accessTokenEncrypted: "encrypted:synthetic-access",
        refreshTokenEncrypted: "encrypted:synthetic-refresh", scope: "openid calendar.events",
      }),
    );
    expect(mocks.findOrCreateProviderUser).not.toHaveBeenCalled();
    expect(mocks.acceptPendingInvitation).not.toHaveBeenCalled();
    expect(mocks.createDatabaseSession).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.refreshCurrentUserCalendarPreferences).not.toHaveBeenCalled();
  });

  it("fails closed when the connection initiation expired instead of logging in another account", async () => {
    mocks.consumeNativeConnectionCode.mockResolvedValue(null);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await GET(callback());
      expect(response.headers.get("location")).toContain("error=callback");
      expect(mocks.findOrCreateProviderUser).not.toHaveBeenCalled();
      expect(mocks.createNativeAuthorizationCode).not.toHaveBeenCalled();
      expect(mocks.query).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});

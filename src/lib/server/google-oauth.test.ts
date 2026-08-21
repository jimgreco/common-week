import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createGoogleAuthorization,
  GOOGLE_CALENDAR_WRITE_SCOPE,
  GOOGLE_SCOPES,
} from "@/lib/server/google-oauth";

describe("Google OAuth authorization", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://weekofus.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requests the canonical Week of Us callback", async () => {
    const authorization = await createGoogleAuthorization();
    const url = new URL(authorization.url);

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe("https://weekofus.com/auth/callback");
  });

  it("uses least-privilege read scopes before calendar editing is enabled", async () => {
    expect(GOOGLE_SCOPES).toContain("https://www.googleapis.com/auth/calendar.calendarlist.readonly");
    expect(GOOGLE_SCOPES).toContain("https://www.googleapis.com/auth/calendar.events.readonly");
    expect(GOOGLE_SCOPES).not.toContain("https://www.googleapis.com/auth/calendar.readonly");

    const authorization = await createGoogleAuthorization();
    const requestedScopes = new Set(new URL(authorization.url).searchParams.get("scope")?.split(" "));

    expect(requestedScopes).toEqual(new Set(GOOGLE_SCOPES));
    expect(requestedScopes).not.toContain(GOOGLE_CALENDAR_WRITE_SCOPE);
  });

  it("requests calendar event editing only through the explicit opt-in flow", async () => {
    const authorization = await createGoogleAuthorization({ calendarWrite: true });
    const requestedScopes = new Set(new URL(authorization.url).searchParams.get("scope")?.split(" "));

    expect(requestedScopes).toEqual(new Set([...GOOGLE_SCOPES, GOOGLE_CALENDAR_WRITE_SCOPE]));
  });
});

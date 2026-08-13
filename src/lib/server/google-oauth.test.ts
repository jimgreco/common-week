import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createGoogleAuthorization } from "@/lib/server/google-oauth";

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
});

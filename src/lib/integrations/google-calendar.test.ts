import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  GoogleCalendarApiError,
  GoogleCalendarApiService,
  isGoogleCalendarApiDisabled,
} from "@/lib/integrations/google-calendar";

describe("GoogleCalendarApiService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("classifies a disabled Calendar API without exposing provider data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        status: "PERMISSION_DENIED",
        message: "Project-specific provider detail",
        errors: [{ reason: "accessNotConfigured" }],
      },
    }), { status: 403, headers: { "Content-Type": "application/json" } })));

    const request = new GoogleCalendarApiService().listCalendars("opaque-token");
    await expect(request).rejects.toMatchObject({
      name: "GoogleCalendarApiError",
      statusCode: 403,
      reason: "accessNotConfigured",
      googleStatus: "PERMISSION_DENIED",
      message: "Google Calendar returned 403.",
    });
    await request.catch((error: unknown) => {
      expect(error).toBeInstanceOf(GoogleCalendarApiError);
      expect(isGoogleCalendarApiDisabled(error)).toBe(true);
      expect((error as Error).message).not.toContain("Project-specific");
    });
  });

  it("maps a successful calendar list response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{ id: "primary@example.com", summary: "Home", primary: true, backgroundColor: "#123456" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(new GoogleCalendarApiService().listCalendars("opaque-token")).resolves.toEqual([{
      id: "primary@example.com",
      summary: "Home",
      primary: true,
      backgroundColor: "#123456",
      accessRole: "reader",
    }]);
  });
});

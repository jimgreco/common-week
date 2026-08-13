import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  GoogleCalendarApiError,
  GoogleCalendarApiService,
  isGoogleCalendarApiDisabled,
} from "@/lib/integrations/google-calendar";
import type { CalendarPreference } from "@/types/domain";

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

  it("normalizes event details including location and end time", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{
        id: "event-1",
        summary: "Dinner reservation",
        description: "Patio table requested.",
        location: "177 Main Street",
        htmlLink: "https://calendar.google.com/event?eid=example",
        start: { dateTime: "2026-08-15T19:00:00-04:00" },
        end: { dateTime: "2026-08-15T21:00:00-04:00" },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const preference: CalendarPreference = {
      id: "preference",
      googleCalendarId: "family@example.com",
      calendarName: "Family",
      displayAlias: null,
      displayAbbreviation: null,
      color: "#688173",
      isSelected: true,
      isPrimary: false,
      sectionGroup: "supplemental",
    };

    await expect(new GoogleCalendarApiService().listEvents(
      "opaque-token",
      preference,
      "2026-08-10T04:00:00Z",
      "2026-08-17T04:00:00Z",
      "America/New_York",
      "FA",
    )).resolves.toEqual([expect.objectContaining({
      id: "family@example.com:event-1",
      title: "Dinner reservation",
      description: "Patio table requested.",
      location: "177 Main Street",
      googleUrl: "https://calendar.google.com/event?eid=example",
      end: "2026-08-15T21:00:00-04:00",
      sectionGroup: "supplemental",
    })]);
  });
});

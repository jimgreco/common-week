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
        etag: "etag-1",
        recurringEventId: "series-1",
        originalStartTime: { dateTime: "2026-08-15T19:00:00-04:00" },
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
      userId: "user",
      googleCalendarId: "family@example.com",
      calendarName: "Family",
      displayAlias: null,
      displayAbbreviation: null,
      color: "#688173",
      visibility: "share",
      isPrimary: false,
      sectionGroup: "supplemental",
      accessRole: "writer",
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
      providerEventId: "event-1",
      sourceUserId: "user",
      calendarPreferenceId: "preference",
      etag: "etag-1",
      recurringEventId: "series-1",
      title: "Dinner reservation",
      description: "Patio table requested.",
      location: "177 Main Street",
      googleUrl: "https://calendar.google.com/event?eid=example",
      end: "2026-08-15T21:00:00-04:00",
      sectionGroup: "supplemental",
    })]);
  });

  it("creates, updates, moves, and deletes through the selected calendar with concurrency headers", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "event-2", summary: "Lunch", start: {}, end: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "event-2", summary: "Lunch later", start: {}, end: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "event-2", summary: "Lunch later", start: {}, end: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new GoogleCalendarApiService();
    const input = {
      summary: "Lunch",
      start: { dateTime: "2026-08-15T16:00:00.000Z", timeZone: "America/New_York" },
      end: { dateTime: "2026-08-15T17:00:00.000Z", timeZone: "America/New_York" },
    };

    await service.createEvent("opaque-token", "family@example.com", input);
    await service.updateEvent("opaque-token", "family@example.com", "event-2", "etag-1", { ...input, summary: "Lunch later" });
    await service.moveEvent("opaque-token", "family@example.com", "event-2", "personal@example.com");
    await service.deleteEvent("opaque-token", "family@example.com", "event-2", "etag-2");

    expect(fetchMock.mock.calls[0][0].pathname).toBe("/calendar/v3/calendars/family%40example.com/events");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", body: JSON.stringify(input) });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "PATCH", headers: { "If-Match": "etag-1" } });
    expect(fetchMock.mock.calls[2][0].pathname).toBe("/calendar/v3/calendars/family%40example.com/events/event-2/move");
    expect(fetchMock.mock.calls[2][0].searchParams.get("destination")).toBe("personal@example.com");
    expect(fetchMock.mock.calls[2][0].searchParams.get("sendUpdates")).toBe("none");
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[3][1]).toMatchObject({ method: "DELETE", headers: { "If-Match": "etag-2" } });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createEvent: vi.fn(),
  deleteEvent: vi.fn(),
  getEvent: vi.fn(),
  getGoogleAccessToken: vi.fn(),
  moveEvent: vi.fn(),
  patchEvent: vi.fn(),
  queueHouseholdChange: vi.fn(),
  query: vi.fn(),
  requireHouseholdContext: vi.fn(),
  revalidatePath: vi.fn(),
  updateEvent: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/server/auth", () => ({
  requireHouseholdContext: (...args: unknown[]) => mocks.requireHouseholdContext(...args),
}));
vi.mock("@/lib/server/database", () => ({
  query: (...args: unknown[]) => mocks.query(...args),
}));
vi.mock("@/lib/server/google-oauth", () => ({
  GOOGLE_CALENDAR_WRITE_SCOPE: "calendar.events",
  hasGoogleScope: (scope: string | null | undefined, expected: string) =>
    Boolean(scope?.split(" ").includes(expected)),
}));
vi.mock("@/lib/server/google-tokens", () => ({
  getGoogleAccessToken: (...args: unknown[]) => mocks.getGoogleAccessToken(...args),
}));
vi.mock("@/lib/server/notifications", () => ({
  queueHouseholdChange: (...args: unknown[]) => mocks.queueHouseholdChange(...args),
}));
vi.mock("@/lib/integrations/google-calendar", () => {
  class GoogleCalendarApiError extends Error {
    statusCode = 500;
  }
  return {
    GoogleCalendarApiError,
    googleCalendarService: {
      createEvent: (...args: unknown[]) => mocks.createEvent(...args),
      deleteEvent: (...args: unknown[]) => mocks.deleteEvent(...args),
      getEvent: (...args: unknown[]) => mocks.getEvent(...args),
      moveEvent: (...args: unknown[]) => mocks.moveEvent(...args),
      patchEvent: (...args: unknown[]) => mocks.patchEvent(...args),
      updateEvent: (...args: unknown[]) => mocks.updateEvent(...args),
    },
  };
});

import { createCalendarEventAction, deleteCalendarEventAction, respondToCalendarEventAction, updateCalendarEventAction } from "@/app/actions/calendar";

describe("Google Calendar write privacy", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.requireHouseholdContext.mockResolvedValue({
      userId: "member-a",
      householdId: "household-a",
    });
    mocks.getGoogleAccessToken.mockResolvedValue("token-a");
    mocks.createEvent.mockResolvedValue({ id: "event-1" });
    mocks.deleteEvent.mockResolvedValue(undefined);
    mocks.getEvent.mockResolvedValue({ id: "occurrence-1", etag: "etag-1", recurringEventId: "series-1" });
    mocks.moveEvent.mockResolvedValue({ id: "occurrence-1", etag: "etag-moved" });
    mocks.updateEvent.mockResolvedValue({ id: "occurrence-1" });
    mocks.patchEvent.mockResolvedValue({ id: "occurrence-1" });
  });

  it("does not allow event writes through a hidden calendar", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("from calendar_preferences")) return {
        rows: [{
          calendar_owner_user_id: "member-a",
          google_calendar_id: "personal@example.com",
          actor_access_role: "owner",
          visibility: "hide",
          actor_role: "member",
          actor_scope: "calendar.events",
          actor_google_connected: true,
          timezone: "America/New_York",
        }],
        rowCount: 1,
      };
      return {
        rows: [],
        rowCount: 0,
      };
    });

    const result = await createCalendarEventAction({
      requestId: "00000000-0000-4000-8000-000000000010",
      calendarPreferenceId: "00000000-0000-4000-8000-000000000011",
      title: "Private appointment",
      description: "",
      location: "",
      allDay: false,
      startDate: "2026-08-14",
      endDate: "2026-08-14",
      startTime: "10:00",
      endTime: "11:00",
    });

    expect(String(mocks.query.mock.calls[0][0])).toContain("join household_members actor");
    expect(result).toEqual({ ok: false, error: "That calendar is not editable by this household member." });
    expect(mocks.createEvent).not.toHaveBeenCalled();
  });

  it("creates an event for a household member through the actor's Google connection", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("from calendar_preferences")) return {
        rows: [{
          calendar_owner_user_id: "member-b",
          google_calendar_id: "family@example.com",
          actor_access_role: "writer",
          visibility: "share",
          actor_role: "member",
          actor_scope: "calendar.events",
          actor_google_connected: true,
          timezone: "America/New_York",
        }],
        rowCount: 1,
      };
      return { rows: [], rowCount: 0 };
    });
    mocks.getGoogleAccessToken.mockImplementation(async (userId: string) => userId === "member-a" ? "token-a" : null);

    const result = await createCalendarEventAction({
      requestId: "00000000-0000-4000-8000-000000000010",
      calendarPreferenceId: "00000000-0000-4000-8000-000000000011",
      title: "Shared family event",
      description: "",
      location: "",
      allDay: false,
      startDate: "2026-08-14",
      endDate: "2026-08-14",
      startTime: "10:00",
      endTime: "11:00",
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.getGoogleAccessToken).toHaveBeenCalledWith("member-a");
    expect(mocks.createEvent).toHaveBeenCalledWith(
      "token-a",
      "family@example.com",
      expect.objectContaining({ summary: "Shared family event" }),
    );
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("delete from calendar_event_cache"),
      ["household-a"],
    );
  });

  it("creates a recurring event with normalized guest invitations", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("from calendar_preferences")) return {
        rows: [{
          calendar_owner_user_id: "member-a",
          google_calendar_id: "family@example.com",
          actor_access_role: "owner",
          visibility: "private",
          actor_role: "member",
          actor_scope: "calendar.events",
          actor_google_connected: true,
          timezone: "America/New_York",
        }],
        rowCount: 1,
      };
      return { rows: [], rowCount: 0 };
    });

    const result = await createCalendarEventAction({
      requestId: "00000000-0000-4000-8000-000000000010",
      calendarPreferenceId: "00000000-0000-4000-8000-000000000011",
      title: "Biweekly dinner",
      description: "",
      location: "",
      allDay: false,
      startDate: "2026-08-14",
      endDate: "2026-08-14",
      startTime: "18:00",
      endTime: "19:00",
      recurrence: {
        frequency: "weekly",
        interval: 2,
        weekdays: ["FR"],
        ends: "afterCount",
        count: 6,
      },
      guestEmails: ["Guest@Example.com", "friend@example.com"],
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.createEvent).toHaveBeenCalledWith(
      "token-a",
      "family@example.com",
      expect.objectContaining({
        recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;COUNT=6"],
        attendees: [{ email: "guest@example.com" }, { email: "friend@example.com" }],
      }),
    );
  });

  it("explains when Google has not shared a household calendar with the actor", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("from calendar_preferences")) return {
        rows: [{
          calendar_owner_user_id: "member-b",
          google_calendar_id: "family@example.com",
          actor_access_role: null,
          visibility: "share",
          actor_role: "member",
          actor_scope: "calendar.events",
          actor_google_connected: true,
          timezone: "America/New_York",
        }],
        rowCount: 1,
      };
      return { rows: [], rowCount: 0 };
    });

    const result = await createCalendarEventAction({
      requestId: "00000000-0000-4000-8000-000000000010",
      calendarPreferenceId: "00000000-0000-4000-8000-000000000011",
      title: "Shared family event",
      description: "",
      location: "",
      allDay: false,
      startDate: "2026-08-14",
      endDate: "2026-08-14",
      startTime: "10:00",
      endTime: "11:00",
    });

    expect(result).toEqual({
      ok: false,
      error: "Google has not shared this calendar with your account. Add it in Google Calendar, then refresh calendars in Settings.",
    });
    expect(mocks.createEvent).not.toHaveBeenCalled();
  });

  it("updates one recurring occurrence after verifying its current ETag", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("from calendar_preferences")) return {
        rows: [{
          calendar_owner_user_id: "member-a",
          google_calendar_id: "family@example.com",
          actor_access_role: "owner",
          visibility: "share",
          actor_role: "member",
          actor_scope: "calendar.events",
          actor_google_connected: true,
          timezone: "America/New_York",
        }],
        rowCount: 1,
      };
      return { rows: [], rowCount: 0 };
    });

    const result = await updateCalendarEventAction({
      requestId: "00000000-0000-4000-8000-000000000010",
      calendarPreferenceId: "00000000-0000-4000-8000-000000000011",
      providerEventId: "occurrence-1",
      etag: "etag-1",
      title: "Weekly lesson, later",
      description: "",
      location: "",
      allDay: false,
      startDate: "2026-08-14",
      endDate: "2026-08-14",
      startTime: "11:00",
      endTime: "12:00",
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.updateEvent).toHaveBeenCalledWith(
      "token-a",
      "family@example.com",
      "occurrence-1",
      "etag-1",
      expect.objectContaining({ summary: "Weekly lesson, later" }),
    );
  });

  it("moves an edited event between calendars on the same Google connection", async () => {
    const sourcePreferenceId = "00000000-0000-4000-8000-000000000011";
    const destinationPreferenceId = "00000000-0000-4000-8000-000000000012";
    mocks.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("from calendar_preferences")) {
        const destination = params?.[0] === destinationPreferenceId;
        return {
          rows: [{
            calendar_owner_user_id: "member-a",
            google_calendar_id: destination ? "personal@example.com" : "family@example.com",
            actor_access_role: "owner",
            visibility: "private",
            actor_role: "member",
            actor_scope: "calendar.events",
            actor_google_connected: true,
            timezone: "America/New_York",
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    mocks.getEvent.mockResolvedValue({
      id: "event-1",
      etag: "etag-1",
      eventType: "default",
      start: { dateTime: "2026-08-14T10:00:00-04:00" },
      end: { dateTime: "2026-08-14T11:00:00-04:00" },
    });

    const result = await updateCalendarEventAction({
      requestId: "00000000-0000-4000-8000-000000000010",
      sourceCalendarPreferenceId: sourcePreferenceId,
      calendarPreferenceId: destinationPreferenceId,
      providerEventId: "event-1",
      etag: "etag-1",
      title: "Moved appointment",
      description: "",
      location: "",
      allDay: false,
      startDate: "2026-08-14",
      endDate: "2026-08-14",
      startTime: "10:00",
      endTime: "11:00",
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.updateEvent).toHaveBeenCalledWith(
      "token-a",
      "family@example.com",
      "event-1",
      "etag-1",
      expect.objectContaining({ summary: "Moved appointment" }),
    );
    expect(mocks.moveEvent).toHaveBeenCalledWith(
      "token-a",
      "family@example.com",
      "event-1",
      "personal@example.com",
    );
  });

  it("moves between calendars from different household connections when the actor can write both", async () => {
    const sourcePreferenceId = "00000000-0000-4000-8000-000000000011";
    const destinationPreferenceId = "00000000-0000-4000-8000-000000000012";
    mocks.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("from calendar_preferences")) {
        const destination = params?.[0] === destinationPreferenceId;
        return {
          rows: [{
            calendar_owner_user_id: destination ? "member-b" : "member-a",
            google_calendar_id: destination ? "partner@example.com" : "family@example.com",
            actor_access_role: "writer",
            visibility: "share",
            actor_role: "member",
            actor_scope: "calendar.events",
            actor_google_connected: true,
            timezone: "America/New_York",
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await updateCalendarEventAction({
      requestId: "00000000-0000-4000-8000-000000000010",
      sourceCalendarPreferenceId: sourcePreferenceId,
      calendarPreferenceId: destinationPreferenceId,
      providerEventId: "event-1",
      etag: "etag-1",
      title: "Moved appointment",
      description: "",
      location: "",
      allDay: false,
      startDate: "2026-08-14",
      endDate: "2026-08-14",
      startTime: "10:00",
      endTime: "11:00",
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.updateEvent).toHaveBeenCalled();
    expect(mocks.moveEvent).toHaveBeenCalledWith(
      "token-a",
      "family@example.com",
      "event-1",
      "partner@example.com",
    );
  });

  it("requires a series edit before moving a recurring event", async () => {
    const sourcePreferenceId = "00000000-0000-4000-8000-000000000011";
    const destinationPreferenceId = "00000000-0000-4000-8000-000000000012";
    mocks.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("from calendar_preferences")) {
        return {
          rows: [{
            calendar_owner_user_id: "member-a",
            google_calendar_id: params?.[0] === destinationPreferenceId ? "personal@example.com" : "family@example.com",
            actor_access_role: "owner",
            visibility: "private",
            actor_role: "member",
            actor_scope: "calendar.events",
            actor_google_connected: true,
            timezone: "America/New_York",
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await updateCalendarEventAction({
      requestId: "00000000-0000-4000-8000-000000000010",
      sourceCalendarPreferenceId: sourcePreferenceId,
      calendarPreferenceId: destinationPreferenceId,
      providerEventId: "occurrence-1",
      recurringEventId: "series-1",
      recurringScope: "occurrence",
      etag: "etag-1",
      title: "Weekly lesson",
      description: "",
      location: "",
      allDay: false,
      startDate: "2026-08-14",
      endDate: "2026-08-14",
      startTime: "10:00",
      endTime: "11:00",
    });

    expect(result).toEqual({ ok: false, error: "Choose Entire series before moving a recurring event to another calendar." });
    expect(mocks.getEvent).not.toHaveBeenCalled();
    expect(mocks.updateEvent).not.toHaveBeenCalled();
    expect(mocks.moveEvent).not.toHaveBeenCalled();
  });

  it("deletes one recurring occurrence after verifying its current ETag", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("from calendar_preferences")) return {
        rows: [{
          calendar_owner_user_id: "member-a",
          google_calendar_id: "family@example.com",
          actor_access_role: "writer",
          visibility: "share",
          actor_role: "member",
          actor_scope: "calendar.events",
          actor_google_connected: true,
          timezone: "America/New_York",
        }],
        rowCount: 1,
      };
      return { rows: [], rowCount: 0 };
    });

    const result = await deleteCalendarEventAction({
      calendarPreferenceId: "00000000-0000-4000-8000-000000000011",
      providerEventId: "occurrence-1",
      etag: "etag-1",
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.deleteEvent).toHaveBeenCalledWith(
      "token-a",
      "family@example.com",
      "occurrence-1",
      "etag-1",
    );
  });

  it("updates the recurring master while preserving its schedule", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("from calendar_preferences")) return {
        rows: [{
          calendar_owner_user_id: "member-a", google_calendar_id: "family@example.com", actor_access_role: "owner",
          visibility: "share", actor_role: "member", actor_scope: "calendar.events", actor_google_connected: true, timezone: "America/New_York",
        }],
        rowCount: 1,
      };
      return { rows: [], rowCount: 0 };
    });
    mocks.getEvent.mockResolvedValue({
      id: "series-1", etag: "series-etag", summary: "Weekly lesson",
      start: { dateTime: "2026-08-16T10:00:00-04:00", timeZone: "America/New_York" },
      end: { dateTime: "2026-08-16T11:00:00-04:00", timeZone: "America/New_York" },
      recurrence: ["RRULE:FREQ=WEEKLY"],
    });

    const result = await updateCalendarEventAction({
      requestId: "00000000-0000-4000-8000-000000000010",
      calendarPreferenceId: "00000000-0000-4000-8000-000000000011",
      providerEventId: "occurrence-1",
      recurringEventId: "series-1",
      recurringScope: "series",
      etag: "occurrence-etag",
      title: "Weekly lesson, later",
      description: "Bring a notebook",
      location: "Studio",
      allDay: false,
      startDate: "2026-09-20",
      endDate: "2026-09-20",
      startTime: "11:00",
      endTime: "12:00",
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.updateEvent).toHaveBeenCalledWith(
      "token-a", "family@example.com", "series-1", "series-etag",
      expect.objectContaining({
        summary: "Weekly lesson, later",
        start: expect.objectContaining({ dateTime: "2026-08-16T15:00:00.000Z" }),
      }),
    );
  });

  it("changes only the signed-in attendee's RSVP", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("from calendar_preferences")) return {
        rows: [{
          calendar_owner_user_id: "member-a", google_calendar_id: "primary@example.com", actor_access_role: "owner",
          visibility: "private", actor_role: "member", actor_scope: "calendar.events", actor_google_connected: true, timezone: "America/New_York",
        }],
        rowCount: 1,
      };
      return { rows: [], rowCount: 0 };
    });
    mocks.getEvent.mockResolvedValue({
      id: "invite-1", etag: "invite-etag", summary: "Dinner",
      start: { dateTime: "2026-08-16T18:00:00-04:00" }, end: { dateTime: "2026-08-16T19:00:00-04:00" },
      attendees: [
        { email: "member@example.com", responseStatus: "needsAction", self: true },
        { email: "host@example.com", responseStatus: "accepted", organizer: true },
      ],
    });

    const result = await respondToCalendarEventAction({
      calendarPreferenceId: "00000000-0000-4000-8000-000000000011",
      providerEventId: "invite-1",
      etag: "invite-etag",
      responseStatus: "accepted",
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.patchEvent).toHaveBeenCalledWith(
      "token-a", "primary@example.com", "invite-1", "invite-etag",
      { attendees: [
        { email: "member@example.com", responseStatus: "accepted", self: true },
        { email: "host@example.com", responseStatus: "accepted", organizer: true },
      ] },
      "all",
    );
  });
});

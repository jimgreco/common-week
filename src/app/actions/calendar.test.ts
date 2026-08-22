import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createEvent: vi.fn(),
  deleteEvent: vi.fn(),
  getEvent: vi.fn(),
  getGoogleAccessToken: vi.fn(),
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
  hasGoogleScope: () => true,
}));
vi.mock("@/lib/server/google-tokens", () => ({
  getGoogleAccessToken: (...args: unknown[]) => mocks.getGoogleAccessToken(...args),
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
      updateEvent: (...args: unknown[]) => mocks.updateEvent(...args),
    },
  };
});

import { createCalendarEventAction, deleteCalendarEventAction, updateCalendarEventAction } from "@/app/actions/calendar";

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
    mocks.updateEvent.mockResolvedValue({ id: "occurrence-1" });
  });

  it("does not allow event writes through a hidden calendar", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("from calendar_preferences")) return {
        rows: [{
          calendar_owner_user_id: "member-a",
          google_calendar_id: "personal@example.com",
          access_role: "owner",
          visibility: "hide",
          actor_role: "member",
          scope: "calendar.events",
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

  it("creates an event for a household member through the shared calendar owner's connection", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("from calendar_preferences")) return {
        rows: [{
          calendar_owner_user_id: "member-b",
          google_calendar_id: "family@example.com",
          access_role: "owner",
          visibility: "share",
          actor_role: "member",
          scope: "calendar.events",
          timezone: "America/New_York",
        }],
        rowCount: 1,
      };
      return { rows: [], rowCount: 0 };
    });
    mocks.getGoogleAccessToken.mockImplementation(async (userId: string) => userId === "member-b" ? "token-b" : null);

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
    expect(mocks.getGoogleAccessToken).toHaveBeenCalledWith("member-b");
    expect(mocks.createEvent).toHaveBeenCalledWith(
      "token-b",
      "family@example.com",
      expect.objectContaining({ summary: "Shared family event" }),
    );
    expect(mocks.query).toHaveBeenCalledWith(
      "delete from calendar_event_cache where user_id = $1",
      ["member-b"],
    );
  });

  it("updates one recurring occurrence after verifying its current ETag", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("from calendar_preferences")) return {
        rows: [{
          calendar_owner_user_id: "member-a",
          google_calendar_id: "family@example.com",
          access_role: "owner",
          visibility: "share",
          actor_role: "member",
          scope: "calendar.events",
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

  it("deletes one recurring occurrence after verifying its current ETag", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("from calendar_preferences")) return {
        rows: [{
          calendar_owner_user_id: "member-a",
          google_calendar_id: "family@example.com",
          access_role: "writer",
          visibility: "share",
          actor_role: "member",
          scope: "calendar.events",
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
});

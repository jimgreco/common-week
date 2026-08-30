import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent, CalendarPreference } from "@/types/domain";

const mocks = vi.hoisted(() => ({
  getGoogleAccessToken: vi.fn(),
  listCalendars: vi.fn(),
  listEvents: vi.fn(),
  searchEvents: vi.fn(),
  query: vi.fn(),
  transactionQuery: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/database", () => ({
  query: mocks.query,
  withTransaction: mocks.withTransaction,
}));
vi.mock("@/lib/server/google-tokens", () => ({
  getGoogleAccessToken: (...args: unknown[]) => mocks.getGoogleAccessToken(...args),
}));
vi.mock("@/lib/integrations/google-calendar", () => ({
  googleCalendarService: {
    listCalendars: (...args: unknown[]) => mocks.listCalendars(...args),
    listEvents: (...args: unknown[]) => mocks.listEvents(...args),
    searchEvents: (...args: unknown[]) => mocks.searchEvents(...args),
  },
}));

import {
  getHouseholdCalendarEvents,
  refreshCurrentUserCalendarPreferences,
  searchHouseholdCalendarEvents,
} from "@/lib/server/calendar-data";

function preferenceRow(input: {
  id: string;
  userId: string;
  calendarId: string;
  name: string;
  visibility: CalendarPreference["visibility"];
}) {
  return {
    id: input.id,
    user_id: input.userId,
    google_calendar_id: input.calendarId,
    calendar_name: input.name,
    display_alias: null,
    display_abbreviation: null,
    color: "#345678",
    visibility: input.visibility,
    is_primary: false,
    section_group: "critical" as const,
    access_role: "reader" as const,
  };
}

describe("household calendar privacy", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.withTransaction.mockImplementation(async (
      work: (database: { query: typeof mocks.transactionQuery }) => Promise<unknown>,
    ) => work({ query: mocks.transactionQuery }));
  });

  it("discovers every Google calendar without sharing any by default", async () => {
    const privateRow = preferenceRow({
      id: "preference-private",
      userId: "member-a",
      calendarId: "personal@example.com",
      name: "Personal",
      visibility: "hide",
    });
    mocks.getGoogleAccessToken.mockResolvedValue("token-a");
    mocks.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [privateRow], rowCount: 1 });
    mocks.listCalendars.mockResolvedValue([{
      id: "personal@example.com",
      summary: "Personal",
      primary: true,
      backgroundColor: "#345678",
      accessRole: "owner",
    }]);
    mocks.transactionQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const result = await refreshCurrentUserCalendarPreferences("household-a", "member-a");

    expect(result).toMatchObject({ connected: true, calendars: [{ calendarName: "Personal", visibility: "hide" }] });
    const [insertSql, insertValues] = mocks.transactionQuery.mock.calls[0] as [string, unknown[]];
    expect(insertSql).toContain("insert into calendar_preferences");
    expect(insertSql).toContain("false");
    expect(insertValues[7]).toBe("hide");
  });

  it("shows private calendars only to their owner and shared calendars to the household", async () => {
    const rowsByUser = new Map([
      ["member-a", [
        preferenceRow({ id: "shared-a", userId: "member-a", calendarId: "family-a@example.com", name: "Family A", visibility: "share" }),
        preferenceRow({ id: "private-a", userId: "member-a", calendarId: "personal-a@example.com", name: "Personal A", visibility: "private" }),
        preferenceRow({ id: "hidden-a", userId: "member-a", calendarId: "hidden-a@example.com", name: "Hidden A", visibility: "hide" }),
      ]],
      ["member-b", [
        preferenceRow({ id: "shared-b", userId: "member-b", calendarId: "family-b@example.com", name: "Family B", visibility: "share" }),
        preferenceRow({ id: "private-b", userId: "member-b", calendarId: "work-b@example.com", name: "Work B", visibility: "private" }),
      ]],
    ]);
    mocks.getGoogleAccessToken.mockImplementation(async (userId: string) => `token-${userId}`);
    mocks.query.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("from calendar_preferences")) {
        const rows = rowsByUser.get(String(values[1])) ?? [];
        return { rows, rowCount: rows.length };
      }
      if (sql.includes("from calendar_event_cache")) return { rows: [], rowCount: 0 };
      if (sql.includes("insert into calendar_event_cache")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query in calendar privacy test: ${sql}`);
    });
    mocks.listEvents.mockImplementation(async (
      _accessToken: string,
      preference: CalendarPreference,
    ): Promise<CalendarEvent[]> => [{
      id: `${preference.googleCalendarId}:event-1`,
      title: `${preference.calendarName} event`,
      start: "2026-08-10T10:00:00-04:00",
      end: "2026-08-10T11:00:00-04:00",
      allDay: false,
      calendarId: preference.googleCalendarId,
      calendarName: preference.calendarName,
      calendarAlias: preference.calendarName,
      calendarColor: preference.color,
      attribution: "FA",
      sectionGroup: preference.sectionGroup,
    }]);

    const result = await getHouseholdCalendarEvents(
      "household-a",
      [{ userId: "member-a" }, { userId: "member-b" }],
      "member-a",
      "2026-08-10",
      "America/New_York",
    );

    expect(result.state).toEqual({ status: "ready" });
    expect(result.events.map((event) => event.title)).toEqual(expect.arrayContaining([
      "Family A event",
      "Personal A event",
      "Family B event",
    ]));
    expect(result.events).toHaveLength(3);
    expect(mocks.listEvents).toHaveBeenCalledTimes(3);
    expect(mocks.listEvents.mock.calls.map((call) => (call[1] as CalendarPreference).calendarName)).not.toEqual(
      expect.arrayContaining(["Hidden A", "Work B"]),
    );
  });

  it("uses the searching member's Google access role for editability", async () => {
    const shared = {
      ...preferenceRow({
        id: "shared-b",
        userId: "member-b",
        calendarId: "family@example.com",
        name: "Family",
        visibility: "share",
      }),
      access_role: "owner" as const,
      actor_access_role: "reader" as const,
      actor_scope: "calendar.events",
    };
    mocks.getGoogleAccessToken.mockResolvedValue("owner-token");
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("select h.timezone")) return {
        rows: [{ timezone: "America/New_York", actor_role: "member" }],
        rowCount: 1,
      };
      if (sql.includes("from calendar_preferences")) return { rows: [shared], rowCount: 1 };
      if (sql.includes("from notification_reminders")) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected search query: ${sql}`);
    });
    mocks.searchEvents.mockResolvedValue([{
      id: "family@example.com:event-1",
      providerEventId: "event-1",
      calendarPreferenceId: "shared-b",
      sourceUserId: "member-b",
      title: "Dinner",
      start: "2026-08-10T18:00:00-04:00",
      end: "2026-08-10T19:00:00-04:00",
      allDay: false,
      calendarId: "family@example.com",
      calendarName: "Family",
      calendarAlias: "Family",
      calendarColor: "#345678",
      attribution: "FA",
      sectionGroup: "critical",
    } satisfies CalendarEvent]);

    const result = await searchHouseholdCalendarEvents(
      { householdId: "household-a", userId: "member-a" },
      "Dinner",
    );

    expect(result).toMatchObject([{ title: "Dinner", canEdit: false }]);
    expect(mocks.searchEvents).toHaveBeenCalledWith(
      "owner-token",
      expect.objectContaining({ googleCalendarId: "family@example.com" }),
      "Dinner",
      expect.any(String),
      expect.any(String),
      "America/New_York",
      expect.any(String),
    );
  });
});

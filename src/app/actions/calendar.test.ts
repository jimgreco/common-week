import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createEvent: vi.fn(),
  getGoogleAccessToken: vi.fn(),
  query: vi.fn(),
  requireHouseholdContext: vi.fn(),
  revalidatePath: vi.fn(),
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
    },
  };
});

import { createCalendarEventAction } from "@/app/actions/calendar";

describe("Google Calendar write privacy", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.requireHouseholdContext.mockResolvedValue({
      userId: "member-a",
      householdId: "household-a",
    });
    mocks.getGoogleAccessToken.mockResolvedValue("token-a");
    mocks.createEvent.mockResolvedValue({ id: "event-1" });
  });

  it("does not allow event writes through a calendar that is not shared", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("cp.is_selected")) return { rows: [], rowCount: 0 };
      return {
        rows: [{
          google_calendar_id: "personal@example.com",
          access_role: "owner",
          scope: "calendar.events",
          timezone: "America/New_York",
        }],
        rowCount: 1,
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

    expect(String(mocks.query.mock.calls[0][0])).toContain("cp.is_selected");
    expect(result).toEqual({ ok: false, error: "That calendar is not writable from your Google account." });
    expect(mocks.createEvent).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import { buildGoogleCalendarEventInput, deterministicGoogleEventId } from "@/lib/calendar-event-input";
import type { CalendarEventDraft } from "@/types/domain";

function draft(overrides: Partial<CalendarEventDraft> = {}): CalendarEventDraft {
  return {
    requestId: "019feeb6-e0b2-7140-b310-1849e6abb7b4",
    calendarPreferenceId: "00000000-0000-4000-8000-000000000001",
    title: "Dinner",
    description: "Patio",
    location: "177 Main Street",
    allDay: false,
    startDate: "2026-11-01",
    endDate: "2026-11-01",
    startTime: "09:00",
    endTime: "10:00",
    ...overrides,
  };
}

describe("Google event input", () => {
  it("converts local date/time in the household timezone across DST", () => {
    expect(buildGoogleCalendarEventInput(draft(), "America/New_York")).toEqual(expect.objectContaining({
      start: { dateTime: "2026-11-01T14:00:00.000Z", timeZone: "America/New_York" },
      end: { dateTime: "2026-11-01T15:00:00.000Z", timeZone: "America/New_York" },
    }));
  });

  it("uses Google's exclusive end date for all-day events", () => {
    expect(buildGoogleCalendarEventInput(draft({ allDay: true, startDate: "2026-08-15", endDate: "2026-08-16" }), "America/New_York")).toEqual(expect.objectContaining({
      start: { date: "2026-08-15" },
      end: { date: "2026-08-17" },
    }));
  });

  it("rejects an end before the start and creates a retry-stable provider ID", () => {
    expect(() => buildGoogleCalendarEventInput(draft({ endTime: "08:59" }), "America/New_York")).toThrow("End time must be after");
    expect(deterministicGoogleEventId(draft().requestId)).toBe("ce019feeb6e0b27140b3101849e6abb7b4");
  });
});

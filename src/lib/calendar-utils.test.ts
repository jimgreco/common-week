import { describe, expect, it } from "vitest";
import { eventFallsOnDate, markCalendarConflicts } from "@/lib/calendar-utils";
import type { CalendarEvent } from "@/types/domain";

function event(id: string, start: string, end: string, allDay = false): CalendarEvent {
  return {
    id,
    title: id,
    start,
    end,
    allDay,
    calendarId: "calendar",
    calendarName: "Family",
    calendarAlias: "Family",
    calendarColor: "#66867B",
    attribution: "F",
  };
}

describe("calendar event placement", () => {
  it("marks overlapping timed commitments without marking adjacent ones", () => {
    const result = markCalendarConflicts([
      event("a", "2026-08-10T13:00:00-04:00", "2026-08-10T14:00:00-04:00"),
      event("b", "2026-08-10T13:30:00-04:00", "2026-08-10T14:30:00-04:00"),
      event("c", "2026-08-10T14:30:00-04:00", "2026-08-10T15:00:00-04:00"),
    ]);
    expect(result.map((item) => [item.id, item.isConflict])).toEqual([
      ["a", true], ["b", true], ["c", false],
    ]);
  });

  it("places all-day multi-day events using Google's exclusive end date", () => {
    const trip = event("trip", "2026-08-14", "2026-08-17", true);
    expect(eventFallsOnDate(trip, "2026-08-14", "America/New_York")).toBe(true);
    expect(eventFallsOnDate(trip, "2026-08-16", "America/New_York")).toBe(true);
    expect(eventFallsOnDate(trip, "2026-08-17", "America/New_York")).toBe(false);
  });

  it("respects timezone boundaries for timed events", () => {
    const late = event("late", "2026-08-11T02:30:00Z", "2026-08-11T03:30:00Z");
    expect(eventFallsOnDate(late, "2026-08-10", "America/New_York")).toBe(true);
    expect(eventFallsOnDate(late, "2026-08-11", "America/New_York")).toBe(false);
  });
});

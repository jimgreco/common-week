import { describe, expect, it } from "vitest";
import {
  calendarAbbreviation,
  decorateCalendarEvents,
  eventFallsOnDate,
  markCalendarConflicts,
  normalizeCalendarAbbreviation,
  sortCalendarEvents,
} from "@/lib/calendar-utils";
import type { CalendarEvent, CalendarPreference } from "@/types/domain";

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
    sectionGroup: "critical",
  };
}

describe("calendar event placement", () => {
  it("derives compact calendar badges and normalizes overrides", () => {
    expect(calendarAbbreviation("Family")).toBe("FA");
    expect(calendarAbbreviation("House / Staff")).toBe("HO");
    expect(normalizeCalendarAbbreviation(" f! ")).toBe("F");
    expect(normalizeCalendarAbbreviation("école")).toBe("ÉC");
    expect(calendarAbbreviation("🎉")).toBe("•");
  });

  it("redecorates cached events from current calendar preferences", () => {
    const cached = { ...event("cached", "2026-08-10T09:00:00-04:00", "2026-08-10T10:00:00-04:00"), attribution: "JG" };
    const preference: CalendarPreference = {
      id: "preference",
      googleCalendarId: "calendar",
      calendarName: "Family",
      displayAlias: "Our family",
      displayAbbreviation: null,
      color: "#123456",
      isSelected: true,
      isPrimary: false,
      sectionGroup: "supplemental",
    };

    expect(decorateCalendarEvents([cached], [preference])).toEqual([
      expect.objectContaining({
        attribution: "OU",
        calendarAlias: "Our family",
        calendarColor: "#123456",
        sectionGroup: "supplemental",
      }),
    ]);
    expect(decorateCalendarEvents([cached], [{ ...preference, displayAbbreviation: "FA" }])[0].attribution).toBe("FA");
  });

  it("interleaves calendars chronologically with all-day events first", () => {
    const jimAfternoon = { ...event("jim-afternoon", "2026-08-10T13:05:00-04:00", "2026-08-10T14:00:00-04:00"), calendarAlias: "Jim" };
    const familyAllDay = { ...event("family-all-day", "2026-08-10", "2026-08-11", true), calendarAlias: "Family" };
    const kidsMorning = { ...event("kids-morning", "2026-08-10T09:00:00-04:00", "2026-08-10T10:00:00-04:00"), calendarAlias: "Kids" };
    const houseEarly = { ...event("house-early", "2026-08-10T08:30:00-04:00", "2026-08-10T09:30:00-04:00"), calendarAlias: "House" };
    const rachelEvening = { ...event("rachel-evening", "2026-08-10T19:30:00-04:00", "2026-08-10T20:30:00-04:00"), calendarAlias: "Rachel" };

    expect(sortCalendarEvents([
      jimAfternoon,
      familyAllDay,
      kidsMorning,
      rachelEvening,
      houseEarly,
    ]).map((item) => item.id)).toEqual([
      "family-all-day",
      "house-early",
      "kids-morning",
      "jim-afternoon",
      "rachel-evening",
    ]);
  });

  it("uses stable calendar, title, and id tie-breakers for matching times", () => {
    const start = "2026-08-10T09:00:00-04:00";
    const end = "2026-08-10T10:00:00-04:00";
    const events = [
      { ...event("family-z", start, end), calendarAlias: "Family", title: "Zoo" },
      { ...event("kids", start, end), calendarAlias: "Kids", title: "Camp" },
      { ...event("family-a", start, end), calendarAlias: "Family", title: "Apple" },
    ];

    expect(sortCalendarEvents(events).map((item) => item.id)).toEqual(["family-a", "family-z", "kids"]);
    expect(events.map((item) => item.id)).toEqual(["family-z", "kids", "family-a"]);
  });

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

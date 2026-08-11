import { describe, expect, it } from "vitest";
import { addDateDays, datesForLocationScope, formatWeekRange, isDateOnly, weekDates, weekStartForDate } from "@/lib/date";

describe("date-only week handling", () => {
  it("always finds Monday across a month and year boundary", () => {
    expect(weekStartForDate("2026-01-01")).toBe("2025-12-29");
    expect(weekDates("2025-12-29")).toEqual([
      "2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04",
    ]);
  });

  it("does not shift date-only values at DST transitions", () => {
    expect(addDateDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDateDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(weekStartForDate("2026-03-08")).toBe("2026-03-02");
  });

  it("validates strict date-only input", () => {
    expect(isDateOnly("2026-08-10")).toBe(true);
    expect(isDateOnly("2026-08-10T00:00:00Z")).toBe(false);
    expect(isDateOnly("not-a-date")).toBe(false);
  });

  it("formats same- and cross-month week ranges", () => {
    expect(formatWeekRange("2026-08-10")).toBe("August 10–16");
    expect(formatWeekRange("2026-08-31")).toBe("Aug 31–Sep 6");
  });

  it("expands common multi-day location scopes", () => {
    expect(datesForLocationScope("2026-08-14", "day")).toEqual(["2026-08-14"]);
    expect(datesForLocationScope("2026-08-14", "through-sunday")).toEqual([
      "2026-08-14", "2026-08-15", "2026-08-16",
    ]);
    expect(datesForLocationScope("2026-08-14", "week")).toEqual(weekDates("2026-08-10"));
  });
});

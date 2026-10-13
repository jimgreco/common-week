import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { addDateDays, datesForLocationScope, formatTimestamp, formatWeekRange, isDateOnly, weekDates, weekStartForDate } from "@/lib/date";

describe("household discussion timestamps", () => {
  it("shows the household's date when UTC has already reached tomorrow", () => {
    expect(formatTimestamp("2026-10-13T01:23:00.123Z", "America/New_York")).toBe("Oct 12, 2026, 9:23 PM");
    expect(formatTimestamp("2026-10-12T21:23:00-04:00", "America/New_York")).toBe("Oct 12, 2026, 9:23 PM");
    expect(formatTimestamp("2026-01-01T00:30:00Z", "America/New_York")).toBe("Dec 31, 2025, 7:30 PM");
  });

  it("uses the requested household timezone and daylight-saving offset", () => {
    expect(formatTimestamp("2026-10-13T01:23:00Z", "Asia/Tokyo")).toBe("Oct 13, 2026, 10:23 AM");
    expect(formatTimestamp("2026-03-08T06:30:00Z", "America/New_York")).toBe("Mar 8, 2026, 1:30 AM");
    expect(formatTimestamp("2026-03-08T07:30:00Z", "America/New_York")).toBe("Mar 8, 2026, 3:30 AM");
  });
});

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
    expect(isDateOnly("2026-02-30")).toBe(false);
    expect(isDateOnly("2026-02-29")).toBe(false);
    expect(isDateOnly("2028-02-29")).toBe(true);
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

  it("keeps date-only weeks and labels independent of the browser or server timezone", () => {
    const program = `import { weekStartForDate, formatWeekRange, addDateDays, weekOffset, weekDates } from ${JSON.stringify(pathToFileURL(resolve("src/lib/date.ts")).href)};
      console.log(JSON.stringify({ monday: weekStartForDate('2026-10-12'), sunday: weekStartForDate('2026-10-18'), range: formatWeekRange('2026-10-12'), newYear: formatWeekRange('2025-12-29'), nextDay: addDateDays('2026-03-08', 1), offset: weekOffset('2026-03-02', '2026-03-09'), dates: weekDates('2026-10-12') }));`;
    for (const timeZone of ["Pacific/Kiritimati", "Pacific/Auckland", "America/New_York", "UTC"]) {
      const result = JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", program], { env: { ...process.env, TZ: timeZone }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
      expect(result, timeZone).toEqual({ monday: "2026-10-12", sunday: "2026-10-12", range: "October 12–18", newYear: "Dec 29–Jan 4, 2026", nextDay: "2026-03-09", offset: 1, dates: ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"] });
    }
  });
});

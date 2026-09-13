import { describe, expect, it } from "vitest";
import { layoutTimelineEvents, timelineEventLabel } from "./calendar-timeline";
import type { CalendarEvent } from "@/types/domain";

const zone = "America/New_York";
const day = "2026-09-14";
function event(id: string, start: string, end: string, allDay = false): CalendarEvent {
  return { id, title: id, start, end, allDay, calendarId: "family", calendarName: "Family", calendarAlias: "Family", calendarColor: "#176b55", attribution: "FA", sectionGroup: "critical", isConflict: true };
}
const timed = (id: string, start: string, end: string) => event(id, `${day}T${start}:00-04:00`, `${day}T${end}:00-04:00`);

describe("calendar timeline", () => {
  it("lays out a connected overlap group and reuses columns without colliding", () => {
    const blocks = layoutTimelineEvents([timed("a", "09:00", "12:00"), timed("b", "09:30", "10:30"), timed("c", "10:00", "11:00"), timed("d", "11:00", "12:00"), timed("later", "13:00", "14:00")], day, zone);
    expect(blocks.map(({ column, columnCount, overlaps }) => [column, columnCount, overlaps])).toEqual([[0, 3, true], [1, 3, true], [2, 3, true], [1, 3, true], [0, 1, false]]);
    expect(blocks[0]).toMatchObject({ startMinute: 540, endMinute: 720 });
  });
  it("does not mark back-to-back events or stale filtered conflicts as overlaps", () => {
    const a = timed("a", "09:00", "10:00");
    expect(layoutTimelineEvents([a, timed("b", "10:00", "11:00")], day, zone).every((block) => !block.overlaps && block.columnCount === 1)).toBe(true);
    expect(layoutTimelineEvents([a], day, zone)[0].overlaps).toBe(false);
  });
  it("clips overnight events and excludes the exclusive end day", () => {
    const overnight = event("night", "2026-09-13T23:00:00-04:00", "2026-09-14T02:00:00-04:00");
    expect(layoutTimelineEvents([overnight], day, zone)[0]).toMatchObject({ startMinute: 0, endMinute: 120 });
    expect(layoutTimelineEvents([overnight], "2026-09-13", zone)[0]).toMatchObject({ startMinute: 1380, endMinute: 1440 });
    expect(layoutTimelineEvents([event("midnight", "2026-09-13T22:00:00-04:00", "2026-09-14T00:00:00-04:00")], day, zone)).toEqual([]);
  });
  it("keeps all-day, invalid, and duplicate events out of the timed grid", () => {
    const a = timed("a", "09:00", "10:00");
    expect(layoutTimelineEvents([a, a, event("all", day, "2026-09-15", true), event("bad", "invalid", "invalid"), timed("backwards", "11:00", "10:00")], day, zone).map((block) => block.event.id)).toEqual(["a"]);
  });
  it("uses the household zone even when it is ahead of UTC", () => {
    expect(layoutTimelineEvents([event("tokyo", "2026-09-13T23:30:00Z", "2026-09-14T01:00:00Z")], day, "Asia/Tokyo")[0]).toMatchObject({ startMinute: 510, endMinute: 600 });
  });
  it("keeps spring-forward and repeated-hour events visible with offset-aware labels", () => {
    const spring = event("spring", "2026-03-08T01:30:00-05:00", "2026-03-08T03:30:00-04:00");
    expect(layoutTimelineEvents([spring], "2026-03-08", zone)[0]).toMatchObject({ startMinute: 90, endMinute: 210 });
    const fall = event("fall", "2026-11-01T01:45:00-04:00", "2026-11-01T01:15:00-05:00");
    expect(layoutTimelineEvents([fall], "2026-11-01", zone)[0]).toMatchObject({ startMinute: 105, endMinute: 135 });
    expect(timelineEventLabel(fall, "2026-11-01", zone)).toBe("1:45 AM EDT – 1:15 AM EST");
  });
  it("reserves space for short-event labels without inventing an overlap", () => {
    const blocks = layoutTimelineEvents([timed("short", "09:00", "09:05"), timed("next", "09:05", "10:00")], day, zone);
    expect(blocks.map(({ column, columnCount, overlaps }) => [column, columnCount, overlaps])).toEqual([[0, 2, false], [1, 2, false]]);
  });
});

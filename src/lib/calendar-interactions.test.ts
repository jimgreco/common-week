import { describe, expect, it } from "vitest";
import { applyDemoCalendarDraft, calendarMoveDraft, calendarSlot, newCalendarDraft, slotInstant } from "./calendar-interactions";
import { getDemoPlannerData } from "./demo-data";

const zone = "America/New_York";
const data = getDemoPlannerData();
const source = { ...data.days[0].events[0], start: "2026-09-14T09:00:00-04:00", end: "2026-09-14T10:30:00-04:00", recurringEventId: "series", canEdit: true };

describe("calendar interactions", () => {
  it("snaps to quarter hours and normalizes midnight in either direction", () => {
    expect(calendarSlot("2026-09-14", 607)).toEqual({ date: "2026-09-14", minute: 600 });
    expect(calendarSlot("2026-09-14", 1440)).toEqual({ date: "2026-09-15", minute: 0 });
    expect(calendarSlot("2026-09-14", -15)).toEqual({ date: "2026-09-13", minute: 1425 });
  });
  it("prefills a one-hour event, including the next-day end and household timezone", () => {
    const draft = newCalendarDraft({ date: "2026-09-14", minute: 1425 }, "calendar", "Asia/Tokyo");
    expect(draft).toMatchObject({ calendarPreferenceId: "calendar", startDate: "2026-09-14", startTime: "23:45", endDate: "2026-09-15", endTime: "00:45", allDay: false });
    expect(slotInstant({ date: "2026-09-14", minute: 540 }, "Asia/Tokyo").toISOString()).toBe("2026-09-14T00:00:00.000Z");
  });
  it("preserves duration, calendar identity and concurrency token while moving only the occurrence", () => {
    const draft = calendarMoveDraft(source, { date: "2026-09-16", minute: 1410 }, zone);
    expect(draft).toMatchObject({ calendarPreferenceId: source.calendarPreferenceId, sourceCalendarPreferenceId: source.calendarPreferenceId, providerEventId: source.providerEventId, etag: source.etag, startTime: "23:30", endTime: "01:00", endDate: "2026-09-17", recurringEventId: "series", recurringScope: "occurrence" });
    expect(draft.guestEmails).toBeUndefined();
  });
  it("preserves all-day span with an inclusive editor end across DST", () => {
    expect(calendarMoveDraft({ ...source, allDay: true, start: "2026-03-07", end: "2026-03-10" }, { date: "2026-11-01", minute: null }, zone)).toMatchObject({ startDate: "2026-11-01", endDate: "2026-11-03", allDay: true });
  });
  it("rejects read-only events and missing concurrency tokens", () => {
    for (const event of [{ ...source, canEdit: false }, { ...source, etag: undefined }]) expect(() => calendarMoveDraft(event, { date: "2026-09-14", minute: 600 }, zone)).toThrow(/cannot be moved/);
  });
  it("rejects nonexistent spring times and preserves elapsed duration across the spring change", () => {
    expect(() => newCalendarDraft({ date: "2026-03-08", minute: 150 }, "calendar", zone)).toThrow(/does not exist/);
    expect(calendarMoveDraft(source, { date: "2026-03-08", minute: 90 }, zone)).toMatchObject({ startTime: "01:30", endTime: "04:00" });
  });
  it("does not silently shorten an event ending in the repeated fall hour", () => {
    expect(() => calendarMoveDraft({ ...source, end: "2026-09-14T11:00:00-04:00" }, { date: "2026-11-01", minute: 30 }, zone)).toThrow(/duration/);
  });
  it("actually creates and moves demo events, removes the old placement and clips overnight spans", () => {
    const date = data.days[0].date;
    const draft = { ...newCalendarDraft({ date, minute: 1410 }, data.editableCalendars[0].id, zone), title: "Calendar click test" };
    const created = applyDemoCalendarDraft(data.days, draft, data.editableCalendars, zone);
    const event = created[0].events.find(event => event.title === draft.title)!;
    expect(created[1].events.filter(item => item.id === event.id)).toHaveLength(1);
    const moved = applyDemoCalendarDraft(created, calendarMoveDraft(event, { date: data.days[3].date, minute: 720 }, zone), data.editableCalendars, zone);
    expect(moved.flatMap(day => day.events).filter(item => item.id === event.id)).toHaveLength(1);
    expect(moved[3].events.find(item => item.id === event.id)?.start).toContain("T16:00:00");
  });
});

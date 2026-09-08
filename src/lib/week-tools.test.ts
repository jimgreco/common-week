import { describe, it, expect } from "vitest";
import {
  defaultCoverage,
  coverageWarnings,
  childrenForEvent,
} from "./coverage";
import { defaultWeekShare, shareWeek, weekHTML } from "./week-share";
import type { WeeklyPlannerData, CalendarEvent } from "@/types/domain";
const event = {
  id: "one",
  calendarPreferenceId: "shared",
  providerEventId: "google",
  title: "School <gate>",
  start: "2026-09-08T09:00:00Z",
  end: "2026-09-08T10:00:00Z",
  assignedMemberIds: ["child"],
  allDay: false,
} as CalendarEvent;
const data = {
  household: { name: "Family & friends", timezone: "UTC" },
  weekStart: "2026-09-07",
  visibleCalendars: [
    { id: "shared", visibility: "share" },
    { id: "private", visibility: "private" },
  ],
  days: [
    {
      date: "2026-09-08",
      events: [
        event,
        {
          ...event,
          id: "private",
          calendarPreferenceId: "private",
          title: "Private appointment",
        },
      ],
      items: [
        {
          id: "task",
          type: "task",
          text: "Pack lunch",
          assignedMemberIds: ["child"],
        },
        { id: "note", type: "note", text: "Sensitive note" },
      ],
    },
  ],
  weeklyItems: [],
} as unknown as WeeklyPlannerData;
describe("shareable week privacy", () => {
  it("excludes notes and private calendars unless selected", () => {
    const shared = shareWeek(data, defaultWeekShare);
    expect(shared.days[0].events).toHaveLength(1);
    expect(shared.days[0].items).toHaveLength(1);
    expect(
      shareWeek(data, {
        ...defaultWeekShare,
        notes: true,
        privateCalendars: true,
      }).days[0].events,
    ).toHaveLength(2);
  });
  it("filters people and fails closed for calendars with unknown visibility", () => {
    expect(
      shareWeek(data, { ...defaultWeekShare, memberIds: ["other"] }).days[0]
        .events,
    ).toHaveLength(0);
    expect(
      shareWeek({ ...data, visibleCalendars: [] }, defaultWeekShare).days[0]
        .events,
    ).toHaveLength(0);
  });
  it("escapes content and excludes private data from the exported document", () => {
    const html = weekHTML(data, defaultWeekShare);
    expect(html).toContain("School &lt;gate&gt;");
    expect(html).toContain("Family &amp; friends");
    expect(html).not.toContain("Private appointment");
    expect(html).not.toContain("Sensitive note");
  });
});
describe("coverage", () => {
  it("honors explicitly unassigned event overrides", () => {
    expect(
      childrenForEvent({ ...event, assignedMemberIds: [] }, [
        {
          id: "child",
          name: "Child",
          color: "#000",
          calendarPreferenceIds: ["shared"],
        },
      ]),
    ).toEqual([]);
  });
  it("warns when one adult cannot travel between handoffs and deduplicates siblings", () => {
    const row = {
      ...defaultCoverage("shared", "google", "child"),
      pickupUserId: "adult",
    };
    const next = {
      ...event,
      id: "two",
      providerEventId: "next",
      title: "Practice",
      start: "2026-09-08T10:05:00Z",
      end: "2026-09-08T11:00:00Z",
    };
    const rows = [
      row,
      { ...row, childId: "sibling" },
      { ...defaultCoverage("shared", "next", "child"), dropOffUserId: "adult" },
    ];
    expect(coverageWarnings([event, next], rows)).toHaveLength(1);
    expect(
      coverageWarnings([event, { ...next, allDay: true }], rows),
    ).toHaveLength(0);
  });
  it("does not flag independent adults", () => {
    const next = {
      ...event,
      id: "two",
      providerEventId: "next",
      start: "2026-09-08T10:05:00Z",
    };
    expect(
      coverageWarnings(
        [event, next],
        [
          {
            ...defaultCoverage("shared", "google", "child"),
            pickupUserId: "a",
          },
          { ...defaultCoverage("shared", "next", "child"), dropOffUserId: "b" },
        ],
      ),
    ).toEqual([]);
  });
});

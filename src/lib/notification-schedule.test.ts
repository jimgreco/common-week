import { describe, expect, it } from "vitest";
import { scheduledNotificationOccurrences } from "@/lib/notification-schedule";

describe("scheduled notification catch-up", () => {
  it("catches a morning agenda missed while the worker was down", () => {
    const occurrences = scheduledNotificationOccurrences({
      since: new Date("2026-08-30T10:58:00.000Z"),
      now: new Date("2026-08-30T11:08:00.000Z"),
      timeZone: "America/New_York",
      morningDigestEnabled: true,
      morningDigestTime: "07:00",
      sundayPlanningEnabled: false,
      sundayPlanningTime: "18:00",
    });
    expect(occurrences).toEqual([{
      kind: "morning_digest",
      localDate: "2026-08-30",
      scheduledFor: new Date("2026-08-30T11:00:00.000Z"),
    }]);
  });

  it("catches a Sunday prompt across a restart", () => {
    const occurrences = scheduledNotificationOccurrences({
      since: new Date("2026-08-30T21:30:00.000Z"),
      now: new Date("2026-08-30T22:30:00.000Z"),
      timeZone: "America/New_York",
      morningDigestEnabled: false,
      morningDigestTime: "07:00",
      sundayPlanningEnabled: true,
      sundayPlanningTime: "18:00",
    });
    expect(occurrences.map((occurrence) => occurrence.scheduledFor.toISOString())).toEqual([
      "2026-08-30T22:00:00.000Z",
    ]);
  });

  it("does not replay stale agendas after a long outage", () => {
    const occurrences = scheduledNotificationOccurrences({
      since: new Date("2026-08-20T00:00:00.000Z"),
      now: new Date("2026-08-30T20:00:00.000Z"),
      timeZone: "America/New_York",
      morningDigestEnabled: true,
      morningDigestTime: "07:00",
      sundayPlanningEnabled: true,
      sundayPlanningTime: "18:00",
    });
    expect(occurrences.map((occurrence) => occurrence.kind)).toEqual(["morning_digest"]);
  });
});

import { describe, expect, it } from "vitest";
import { notificationDeliveryDeepLink, plannerNotificationDeepLink, plannerNotificationTarget } from "@/lib/notification-links";

describe("planner notification links", () => {
  it("opens a planning item in its canonical week", () => {
    const path = plannerNotificationDeepLink({ kind: "planning_item", id: "item-123", weekStart: "2026-09-03" });
    expect(path).toBe("/planner?week=2026-08-31&item=item-123");
    expect(plannerNotificationTarget(Object.fromEntries(new URL(path, "https://weekofus.com").searchParams))).toEqual({
      kind: "planning_item",
      id: "item-123",
      weekStart: "2026-08-31",
    });
  });

  it("opens a calendar reminder without exposing its provider event id", () => {
    expect(plannerNotificationDeepLink({
      kind: "calendar_reminder",
      id: "123e4567-e89b-12d3-a456-426614174000",
      weekStart: "2026-08-31",
    })).toBe("/planner?week=2026-08-31&reminder=123e4567-e89b-12d3-a456-426614174000");
  });

  it("ignores malformed targets", () => {
    expect(plannerNotificationTarget({ week: "not-a-date", item: "item-1" })).toBeNull();
    expect(plannerNotificationTarget({ week: "2026-08-31", item: "../settings" })).toBeNull();
  });

  it("adds an inbox identity without changing the planner target", () => {
    const path = notificationDeliveryDeepLink(
      "/planner?week=2026-08-31&item=item-123",
      "123e4567-e89b-12d3-a456-426614174000",
    );
    expect(path).toBe("/planner?week=2026-08-31&item=item-123&notification=123e4567-e89b-12d3-a456-426614174000");
    expect(plannerNotificationTarget(Object.fromEntries(new URL(path, "https://weekofus.com").searchParams))).toEqual({
      kind: "planning_item",
      id: "item-123",
      weekStart: "2026-08-31",
    });
  });

  it("keeps delivery links on the application origin", () => {
    expect(notificationDeliveryDeepLink("https://example.com/steal", "notification-id")).toBe("/planner");
  });
});

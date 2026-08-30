import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/database", () => ({ query: mocks.query }));
vi.mock("@/lib/server/planner-data", () => ({ getPlannerData: vi.fn() }));

import { getNotificationInbox, markNotificationRead, resolvePlannerNotificationTarget } from "@/lib/server/notifications";

describe("notification history", () => {
  beforeEach(() => mocks.query.mockReset());

  it("maps per-channel state and a stable delivered calendar target", async () => {
    mocks.query.mockResolvedValue({
      rowCount: 1,
      rows: [{
        id: "123e4567-e89b-12d3-a456-426614174000",
        kind: "reminder",
        title: "Upcoming event",
        body: "Dentist",
        deep_link: "/planner?week=2026-08-31&reminder=223e4567-e89b-12d3-a456-426614174000",
        scheduled_for: new Date("2026-09-02T13:00:00.000Z"),
        created_at: new Date("2026-09-02T13:00:00.000Z"),
        read_at: null,
        deliveries: {
          email: { status: "delivered", attempts: 1, deliveredAt: "2026-09-02T13:00:02.000Z", lastError: null },
          push: { status: "failed", attempts: 5, deliveredAt: null, lastError: "Push unavailable." },
        },
        resource_kind: "calendar_event",
        planning_item_id: null,
        calendar_preference_id: "323e4567-e89b-12d3-a456-426614174000",
        provider_event_id: "provider-event",
        target_week_start: "2026-08-31",
        unread_count: 4,
      }],
    });

    await expect(getNotificationInbox("user-id")).resolves.toMatchObject({
      unreadCount: 4,
      items: [{
        channels: {
          email: { status: "delivered", attempts: 1 },
          push: { status: "failed", attempts: 5 },
        },
        target: {
          kind: "calendar_event",
          weekStart: "2026-08-31",
          calendarPreferenceId: "323e4567-e89b-12d3-a456-426614174000",
          providerEventId: "provider-event",
        },
      }],
    });
  });

  it("resolves a fired calendar reminder even after delivery", async () => {
    mocks.query.mockResolvedValue({ rows: [{
      calendar_preference_id: "323e4567-e89b-12d3-a456-426614174000",
      provider_event_id: "provider-event",
      week_start: "2026-08-31",
    }], rowCount: 1 });

    await expect(resolvePlannerNotificationTarget(
      { userId: "user-id", householdId: "household-id" },
      { kind: "calendar_reminder", id: "223e4567-e89b-12d3-a456-426614174000", weekStart: "2026-08-31" },
    )).resolves.toEqual({
      kind: "calendar_event",
      calendarPreferenceId: "323e4567-e89b-12d3-a456-426614174000",
      providerEventId: "provider-event",
      weekStart: "2026-08-31",
    });
    expect(String(mocks.query.mock.calls[0][0])).not.toContain("delivered_at is null");
  });

  it("scopes read state to the signed-in user", async () => {
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
    await markNotificationRead("user-id", "123e4567-e89b-12d3-a456-426614174000");
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("id = $1 and user_id = $2"), [
      "123e4567-e89b-12d3-a456-426614174000",
      "user-id",
    ]);
  });
});

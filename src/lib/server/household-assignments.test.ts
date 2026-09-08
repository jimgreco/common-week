import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/server/database", () => ({ query }));
import { assignCalendarMembers, validateAssignedMembers } from "./household-assignments";
import type { CalendarEvent } from "@/types/domain";
const event = { calendarPreferenceId: "calendar", providerEventId: "google-instance", sourceUserId: "adult" } as CalendarEvent;
describe("persisted household assignments", () => {
  beforeEach(() => query.mockReset());
  it("applies a saved Google occurrence override without changing provider ownership or other occurrences", async () => {
    query.mockResolvedValueOnce({ rows: [{ calendar_id: "calendar", member_id: "adult" }, { calendar_id: "calendar", member_id: "child" }] });
    query.mockResolvedValueOnce({ rows: [{ calendar_preference_id: "calendar", provider_event_id: "google-instance", assigned_member_ids: ["other"] }] });
    const events = await assignCalendarMembers("home", [event, { ...event, providerEventId: "next-instance" }]);
    expect(events[0]).toMatchObject({ assignedMemberIds: ["other"], defaultMemberIds: ["adult", "child"], sourceUserId: "adult" });
    expect(events[1]).toMatchObject({ assignedMemberIds: ["adult", "child"], memberOverrideIds: null });
  });
  it("keeps a deliberately empty override empty", async () => {
    query.mockResolvedValueOnce({ rows: [{ calendar_id: "calendar", member_id: "adult" }] });
    query.mockResolvedValueOnce({ rows: [{ calendar_preference_id: "calendar", provider_event_id: "google-instance", assigned_member_ids: [] }] });
    expect((await assignCalendarMembers("home", [event]))[0].assignedMemberIds).toEqual([]);
  });
  it("rejects a selection containing a member outside the household", async () => {
    query.mockResolvedValue({ rows: [{ id: "adult" }] });
    await expect(validateAssignedMembers("home", ["adult", "foreign"])).rejects.toThrow("Choose members");
    expect(query.mock.calls[0][1]).toEqual(["home", ["adult", "foreign"]]);
  });
});

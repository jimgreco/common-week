import { describe, expect, it } from "vitest";
import { assignedMembersSchema, familyEvent, itemMemberIds } from "./household-assignments";
import { calendarEventMatchesFilters, ALL_CALENDARS } from "@/components/planner/calendar-filters";
import type { CalendarEvent, FamilyPlanningData, PlanningItem } from "@/types/domain";
const event = { id: "event", calendarPreferenceId: "calendar", sourceUserId: "adult" } as CalendarEvent;
const family = { adults: [{ userId: "adult", calendarPreferenceIds: ["calendar"] }], children: [{ id: "child", calendarPreferenceIds: ["calendar"] }] } as FamilyPlanningData;
describe("household assignments", () => {
  it("includes children and adults from defaults, then replaces defaults with an override", () => {
    expect(familyEvent(event, family).assignedMemberIds).toEqual(["adult", "child"]);
    const overridden = familyEvent({ ...event, memberOverrideIds: ["other-adult"] }, family);
    expect(overridden.assignedMemberIds).toEqual(["other-adult"]);
    expect(calendarEventMatchesFilters(overridden, ALL_CALENDARS, "child")).toBe(false);
    expect(calendarEventMatchesFilters(familyEvent(event, family), ALL_CALENDARS, "child")).toBe(true);
  });
  it("distinguishes an empty override from returning to defaults", () => {
    expect(familyEvent({ ...event, memberOverrideIds: [] }, family).assignedMemberIds).toEqual([]);
    expect(familyEvent({ ...event, memberOverrideIds: null }, family).assignedMemberIds).toEqual(["adult", "child"]);
  });
  it("preserves legacy child assignments while allowing explicit clearing", () => {
    expect(itemMemberIds({ childId: "child" } as PlanningItem)).toEqual(["child"]);
    expect(itemMemberIds({ childId: "child", assignedMemberIds: [] } as unknown as PlanningItem)).toEqual([]);
    expect(itemMemberIds({ assignedMemberIds: ["adult", "child"] } as PlanningItem)).toEqual(["adult", "child"]);
  });
  it("deduplicates member identifiers and rejects invalid inputs", () => {
    const id = "12345678-1234-4234-8234-123456789012";
    expect(assignedMembersSchema.parse([id,id])).toEqual([id]);
    expect(assignedMembersSchema.safeParse(["invalid"]).success).toBe(false);
  });
});

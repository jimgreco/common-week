import { describe, expect, it } from "vitest";
import { carryoverLabel, taskCarryoverContext } from "@/lib/task-carryover";
import type { PlanningItem } from "@/types/domain";

function item(overrides: Partial<PlanningItem> = {}): PlanningItem {
  return {
    id: "task-1",
    planningDate: "2026-08-27",
    weekStartDate: "2026-08-24",
    type: "task",
    text: "Pack lunches",
    isCompleted: false,
    sortOrder: 0,
    createdBy: "user-1",
    updatedAt: "2026-08-27T12:00:00.000Z",
    ...overrides,
  };
}

describe("task carryover context", () => {
  it("uses the household date rather than the server date around midnight", () => {
    const now = new Date("2026-08-31T02:30:00.000Z");
    expect(taskCarryoverContext("America/New_York", "2026-08-24", now)).toEqual({
      today: "2026-08-30",
      currentWeekStart: "2026-08-24",
      shouldCarry: true,
    });
    expect(taskCarryoverContext("Asia/Tokyo", "2026-08-31", now)).toEqual({
      today: "2026-08-31",
      currentWeekStart: "2026-08-31",
      shouldCarry: true,
    });
  });

  it("does not carry tasks while viewing a past or future week", () => {
    const now = new Date("2026-08-27T12:00:00.000Z");
    expect(taskCarryoverContext("America/New_York", "2026-08-17", now).shouldCarry).toBe(false);
    expect(taskCarryoverContext("America/New_York", "2026-08-31", now).shouldCarry).toBe(false);
  });

  it("remains date-only and DST-safe", () => {
    const spring = taskCarryoverContext("America/New_York", "2026-03-02", new Date("2026-03-08T07:30:00.000Z"));
    const fall = taskCarryoverContext("America/New_York", "2026-10-26", new Date("2026-11-01T06:30:00.000Z"));
    expect(spring.today).toBe("2026-03-08");
    expect(fall.today).toBe("2026-11-01");
  });
});

describe("carryover labels", () => {
  it("labels daily and weekly origins without changing task identity", () => {
    expect(carryoverLabel(item({
      originalPlanningDate: "2026-08-25",
      originalWeekStartDate: "2026-08-24",
      carryoverCount: 2,
    }))).toBe("Carried from Tue, Aug 25");
    expect(carryoverLabel(item({
      planningDate: null,
      originalPlanningDate: null,
      originalWeekStartDate: "2026-08-10",
      carryoverCount: 2,
    }))).toBe("Carried from week of Aug 10");
    expect(carryoverLabel(item({ carryoverCount: 0 }))).toBeNull();
  });
});

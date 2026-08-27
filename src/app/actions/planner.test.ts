import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  carryOverOpenTasks: vi.fn(),
  query: vi.fn(),
  queueHouseholdChange: vi.fn(),
  requireHouseholdContext: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/server/auth", () => ({
  requireHouseholdContext: (...args: unknown[]) => mocks.requireHouseholdContext(...args),
  requireUserContext: vi.fn(),
}));
vi.mock("@/lib/server/database", () => ({
  postgresErrorCode: vi.fn(),
  query: (...args: unknown[]) => mocks.query(...args),
  withTransaction: vi.fn(),
}));
vi.mock("@/lib/server/notifications", () => ({
  queueHouseholdChange: (...args: unknown[]) => mocks.queueHouseholdChange(...args),
  upsertPlanningReminder: vi.fn(),
}));
vi.mock("@/lib/server/planning-carryover", () => ({
  carryOverOpenTasks: (...args: unknown[]) => mocks.carryOverOpenTasks(...args),
}));

import { togglePlanningItemAction } from "@/app/actions/planner";

describe("togglePlanningItemAction carryover ordering", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.requireHouseholdContext.mockResolvedValue({
      userId: "user-a",
      householdId: "household-a",
      displayName: "Jim",
    });
    mocks.carryOverOpenTasks.mockResolvedValue(1);
    mocks.queueHouseholdChange.mockResolvedValue(undefined);
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("select h.timezone")) return { rows: [{ timezone: "America/New_York" }], rowCount: 1 };
      if (sql.includes("update planning_items")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    });
  });

  it("places an offline-carried task in the current day before completing it", async () => {
    const result = await togglePlanningItemAction("00000000-0000-4000-8000-000000000001", true);

    expect(result.ok).toBe(true);
    expect(mocks.carryOverOpenTasks).toHaveBeenCalledWith(expect.objectContaining({
      householdId: "household-a",
      timeZone: "America/New_York",
    }));
    const updateCall = mocks.query.mock.calls.find((call) => String(call[0]).includes("update planning_items"))!;
    expect(updateCall[1]).toEqual(["00000000-0000-4000-8000-000000000001", "household-a", true]);
    expect(mocks.carryOverOpenTasks.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.query.mock.invocationCallOrder[1],
    );
  });

  it("reopens an old task before making it eligible to carry again", async () => {
    const result = await togglePlanningItemAction("00000000-0000-4000-8000-000000000001", false);

    expect(result.ok).toBe(true);
    expect(mocks.query.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.carryOverOpenTasks.mock.invocationCallOrder[0],
    );
  });
});

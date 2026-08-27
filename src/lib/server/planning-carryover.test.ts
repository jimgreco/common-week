import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/database", () => ({ query: mocks.query }));

import { carryOverOpenTasks } from "@/lib/server/planning-carryover";

describe("carryOverOpenTasks", () => {
  beforeEach(() => mocks.query.mockReset());

  it("calls the atomic database operation for the household current week", async () => {
    mocks.query.mockResolvedValue({ rows: [{ carried_count: 4 }], rowCount: 1 });
    const now = new Date("2026-08-27T12:00:00.000Z");

    await expect(carryOverOpenTasks({
      householdId: "00000000-0000-4000-8000-000000000001",
      timeZone: "America/New_York",
      requestedWeekStart: "2026-08-24",
      now,
    })).resolves.toBe(4);

    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("carry_over_open_tasks");
    expect(values).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "2026-08-27",
      "2026-08-24",
      now.toISOString(),
    ]);
  });

  it("does not mutate data for historical or future planner requests", async () => {
    const common = {
      householdId: "00000000-0000-4000-8000-000000000001",
      timeZone: "America/New_York",
      now: new Date("2026-08-27T12:00:00.000Z"),
    };
    await expect(carryOverOpenTasks({ ...common, requestedWeekStart: "2026-08-17" })).resolves.toBe(0);
    await expect(carryOverOpenTasks({ ...common, requestedWeekStart: "2026-08-31" })).resolves.toBe(0);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

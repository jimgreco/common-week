import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  withTransaction: vi.fn(),
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
  withTransaction: (...args: unknown[]) => mocks.withTransaction(...args),
}));
vi.mock("@/lib/server/notifications", () => ({
  queueHouseholdChange: (...args: unknown[]) => mocks.queueHouseholdChange(...args),
  upsertPlanningReminder: vi.fn(),
}));
vi.mock("@/lib/server/planning-carryover", () => ({
  carryOverOpenTasks: (...args: unknown[]) => mocks.carryOverOpenTasks(...args),
}));

import { createPlanningItemAction, togglePlanningItemAction } from "@/app/actions/planner";

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


describe("inline planning item insertion", () => {
  const first = "aaaaaaaa-0000-4000-8000-000000000001";
  const second = "00000000-0000-4000-8000-000000000002";
  const created = "00000000-0000-4000-8000-000000000003";
  const input = { id: created, afterItemId: first, text: "Next plan", type: "note" as const,
    planningDate: null, weekStartDate: "2026-09-28" };
  let inserted: boolean;
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    inserted = true;
    mocks.requireHouseholdContext.mockResolvedValue({ userId: "user-a", householdId: "household-a", displayName: "Jim", role: "owner" });
    mocks.withTransaction.mockImplementation((work) => work({ query: mocks.query }));
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("insert into planning_items")) return { rows: inserted ? [{ id: created }] : [] };
      if (sql.includes("order by sort_order")) return { rows: [{ id: first }, { id: second }] };
      if (sql.includes("select pi.id")) return { rows: [{ id: created, type: "note", text: "Next plan", planning_date: null,
        week_start_date: "2026-09-28", updated_at: new Date(), created_by: "user-a", sort_order: 2 }] };
      return { rows: [] };
    });
  });

  it("inserts immediately after the anchor within its household, week, day and type", async () => {
    expect((await createPlanningItemAction(input)).ok).toBe(true);
    const siblings = mocks.query.mock.calls.find(([sql]) => sql.includes("order by sort_order"));
    expect(siblings?.[1]).toEqual(["household-a", "2026-09-28", null, "note", created]);
    const reorder = mocks.query.mock.calls.find(([sql]) => sql.includes("with ordinality"));
    expect(reorder?.[1]).toEqual([[first, created, second], "household-a"]);
  });

  it("recognizes uppercase UUID anchors from native clients", async () => {
    expect((await createPlanningItemAction({ ...input, afterItemId: first.toUpperCase() })).ok).toBe(true);
    const reorder = mocks.query.mock.calls.find(([sql]) => sql.includes("with ordinality"));
    expect(reorder?.[1]).toEqual([[first, created, second], "household-a"]);
  });

  it("appends when the anchor was deleted or belongs to another list", async () => {
    expect((await createPlanningItemAction({ ...input, afterItemId: "00000000-0000-4000-8000-000000000099" })).ok).toBe(true);
    const reorder = mocks.query.mock.calls.find(([sql]) => sql.includes("with ordinality"));
    expect(reorder?.[1]).toEqual([[first, second, created], "household-a"]);
  });

  it("does not move an existing item or repeat notifications when retrying a create", async () => {
    inserted = false;
    expect((await createPlanningItemAction(input)).ok).toBe(true);
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("with ordinality"))).toBe(false);
    expect(mocks.queueHouseholdChange).not.toHaveBeenCalled();
  });

  it("rejects viewers before changing any ordering", async () => {
    mocks.requireHouseholdContext.mockResolvedValue({ householdId: "household-a", role: "viewer" });
    expect((await createPlanningItemAction(input)).ok).toBe(false);
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });
});

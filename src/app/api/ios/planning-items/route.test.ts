import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPlanningItemAction: vi.fn(),
  deletePlanningItemAction: vi.fn(),
  requireIOSIdentity: vi.fn(),
  togglePlanningItemAction: vi.fn(),
  updatePlanningItemAction: vi.fn(),
}));

vi.mock("@/app/actions/planner", () => ({
  createPlanningItemAction: (...args: unknown[]) => mocks.createPlanningItemAction(...args),
  deletePlanningItemAction: (...args: unknown[]) => mocks.deletePlanningItemAction(...args),
  togglePlanningItemAction: (...args: unknown[]) => mocks.togglePlanningItemAction(...args),
  updatePlanningItemAction: (...args: unknown[]) => mocks.updatePlanningItemAction(...args),
}));
vi.mock("@/lib/server/ios-api", () => ({
  actionResponse: (result: { ok: boolean; error?: string; data?: unknown }) => Response.json(result, { status: result.ok ? 200 : 400 }),
  requireIOSIdentity: (...args: unknown[]) => mocks.requireIOSIdentity(...args),
  unauthorizedResponse: () => Response.json({ ok: false, error: "Authentication required." }, { status: 401 }),
}));

import { POST } from "@/app/api/ios/planning-items/route";

describe("iOS planning items API", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.requireIOSIdentity.mockResolvedValue({
      identity: { userId: "user-a", householdId: "household-a" },
      token: "session-token",
    });
  });

  it("preserves a native-generated id so an offline create can be replayed safely", async () => {
    const input = {
      id: "00000000-0000-4000-8000-000000000001",
      text: "Book the sitter",
      type: "task",
      planningDate: "2026-08-22",
      weekStartDate: "2026-08-17",
    };
    mocks.createPlanningItemAction.mockResolvedValue({ ok: true, data: { ...input, isCompleted: false } });

    const response = await POST(new NextRequest("https://weekofus.com/api/ios/planning-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }));

    expect(response.status).toBe(200);
    expect(mocks.createPlanningItemAction).toHaveBeenCalledWith(input);
  });
});

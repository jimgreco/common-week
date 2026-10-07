import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/database", () => ({}));
vi.mock("@/lib/server/session", () => ({}));
import { recoverySchema } from "./offline-recovery";
const id = "00000000-0000-4000-8000-000000000001";
const input = { action: "review", originalUserId: id, originalHouseholdId: id, sourceMutationId: id, sourceDigest: "a".repeat(64), draft: { id, text: "Keep these bytes\n", type: "note", planningDate: null, weekStartDate: "2026-10-05" } };
describe("offline recovery input boundary", () => {
  it("preserves source text and undated weekly items", () => {
    expect(recoverySchema.parse(input).draft).toEqual(input.draft);
  });
  it.each(["2026-02-30", "2026-10-12", "", "2026-13-01"])("rejects invalid or out-of-week dates: %s", (planningDate) => {
    expect(recoverySchema.safeParse({ ...input, draft: { ...input.draft, planningDate } }).success).toBe(false);
  });
  it.each(["assignedMemberIds", "childId", "remindAt", "afterItemId"])("does not replay %s", (field) => {
    expect(recoverySchema.safeParse({ ...input, draft: { ...input.draft, [field]: id } }).success).toBe(false);
  });
  it.each(["delete", "toggle", "update", "assignSavedLocation"])("does not accept %s", (action) => {
    expect(recoverySchema.safeParse({ ...input, action }).success).toBe(false);
  });
  it("requires stable IDs, source fingerprint, nonempty text, and a Monday week", () => {
    for (const changes of [{ id: "bad" }, { text: "  " }, { text: "x".repeat(1001) }, { weekStartDate: "2026-10-06" }]) {
      expect(recoverySchema.safeParse({ ...input, draft: { ...input.draft, ...changes } }).success).toBe(false);
    }
    expect(recoverySchema.safeParse({ ...input, sourceDigest: "" }).success).toBe(false);
    expect(recoverySchema.safeParse({ ...input, originalHouseholdId: undefined }).success).toBe(false);
  });
});

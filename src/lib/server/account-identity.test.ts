import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ensurePersonalHousehold } from "@/lib/server/account-identity";

describe("ensurePersonalHousehold", () => {
  it("returns an existing membership without creating another household", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ household_id: "household-existing" }] });

    await expect(ensurePersonalHousehold({ query } as never, "user-1", "Alex")).resolves.toBe("household-existing");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("creates an owned household for a first-time native user", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "household-new" }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await expect(ensurePersonalHousehold({ query } as never, "user-1", "Alex Smith")).resolves.toBe("household-new");
    expect(query).toHaveBeenNthCalledWith(
      2,
      "insert into households (name, timezone) values ($1, $2) returning id",
      ["Alex Smith's household", "America/New_York"],
    );
    expect(query).toHaveBeenNthCalledWith(
      3,
      "insert into household_members (household_id, user_id, role) values ($1, $2, 'owner')",
      ["household-new", "user-1"],
    );
  });
});

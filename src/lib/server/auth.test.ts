import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ identity: vi.fn(), headers: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/server/session", () => ({ currentSessionIdentity: mocks.identity }));

import { requireHouseholdContext } from "@/lib/server/auth";

describe("offline mutation identity binding", () => {
  beforeEach(() => {
    mocks.identity.mockResolvedValue({ userId: "user-a", householdId: "household-a", role: "member" });
    mocks.headers.mockResolvedValue(new Headers());
  });

  it("retains compatibility for requests without replay headers", async () => {
    await expect(requireHouseholdContext()).resolves.toMatchObject({ userId: "user-a", householdId: "household-a" });
  });

  it("accepts both matching identity fields", async () => {
    mocks.headers.mockResolvedValue(new Headers({ "x-week-of-us-user": "user-a", "x-week-of-us-household": "household-a" }));
    await expect(requireHouseholdContext()).resolves.toMatchObject({ userId: "user-a" });
  });

  it.each([
    { "x-week-of-us-user": "user-b", "x-week-of-us-household": "household-a" },
    { "x-week-of-us-user": "user-a", "x-week-of-us-household": "household-b" },
    { "x-week-of-us-user": "user-a" },
    { "x-week-of-us-household": "household-a" },
  ])("rejects changed or incomplete replay identity %j", async (headers) => {
    mocks.headers.mockResolvedValue(new Headers(Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === "string")));
    await expect(requireHouseholdContext()).rejects.toThrow("Your account or household changed");
  });
});

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), planner: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/session", () => ({ SESSION_COOKIE: "session", sessionIdentityForToken: mocks.session }));
vi.mock("@/lib/server/planner-data", () => ({ getPlannerData: mocks.planner }));
import { GET } from "./route";
const request = (query = "source=calendar&week=2026-09-14") => new NextRequest(`http://localhost/api/planner/sources?${query}`, { headers: { Authorization: "Bearer account-token" } });
beforeEach(() => {
  mocks.session.mockReset().mockResolvedValue({ userId: "me", householdId: "my-household" });
  mocks.planner.mockReset().mockResolvedValue({ days: [], calendarState: { status: "ready" }, weatherState: { status: "ready" } });
});
describe("authenticated provider reads", () => {
  it.each(["calendar", "weather"])("loads only %s and derives household from the session", async (source) => {
    const response = await GET(request(`source=${source}&week=2026-09-14&householdId=someone-else&userId=someone-else`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.planner).toHaveBeenCalledExactlyOnceWith({ userId: "me", householdId: "my-household" }, "2026-09-14", { includeExternal: source });
  });
  it("rejects unauthenticated reads before accessing the planner", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401); expect(mocks.planner).not.toHaveBeenCalled();
  });
  it.each(["source=all&week=2026-09-14", "source=weather&week=2026-09-15", "source=calendar&week=bad"])("rejects malformed source/week: %s", async (query) => {
    expect((await GET(request(query))).status).toBe(400); expect(mocks.planner).not.toHaveBeenCalled();
  });
  it("returns a source-specific retryable server failure", async () => {
    mocks.planner.mockRejectedValue(new Error("database internals"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "Calendar could not be refreshed. Try again." });
  });
});

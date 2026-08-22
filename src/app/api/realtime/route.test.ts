import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessionIdentityForToken: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("@/lib/server/realtime", () => ({
  getRealtimeHub: () => ({ subscribe: (...args: unknown[]) => mocks.subscribe(...args) }),
}));
vi.mock("@/lib/server/session", () => ({
  SESSION_COOKIE: "common_week_session",
  sessionIdentityForToken: (...args: unknown[]) => mocks.sessionIdentityForToken(...args),
}));

import { GET } from "@/app/api/realtime/route";

describe("realtime API", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.subscribe.mockResolvedValue(mocks.unsubscribe);
  });

  it("authenticates the native event stream with its bearer session", async () => {
    mocks.sessionIdentityForToken.mockResolvedValue({ householdId: "household-a" });
    const token = "abcdefghijklmnopqrstuvwxyz_123456789";

    const response = await GET(new NextRequest("https://weekofus.com/api/realtime", {
      headers: { Authorization: `Bearer ${token}` },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(mocks.sessionIdentityForToken).toHaveBeenCalledWith(token);
    expect(mocks.subscribe).toHaveBeenCalledWith("household-a", expect.any(Function));
    await response.body?.cancel();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it("rejects an invalid native session before opening a stream", async () => {
    mocks.sessionIdentityForToken.mockResolvedValue(null);

    const response = await GET(new NextRequest("https://weekofus.com/api/realtime", {
      headers: { Authorization: "Bearer abcdefghijklmnopqrstuvwxyz_123456789" },
    }));

    expect(response.status).toBe(401);
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });
});

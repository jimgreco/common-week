import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireIOSIdentity: vi.fn(),
  searchLocationsAction: vi.fn(),
  setDailyLocationAction: vi.fn(),
  setGeocodedLocationAction: vi.fn(),
}));

vi.mock("@/app/actions/planner", () => ({
  searchLocationsAction: (...args: unknown[]) => mocks.searchLocationsAction(...args),
  setDailyLocationAction: (...args: unknown[]) => mocks.setDailyLocationAction(...args),
  setGeocodedLocationAction: (...args: unknown[]) => mocks.setGeocodedLocationAction(...args),
}));

vi.mock("@/lib/server/ios-api", () => ({
  actionResponse: (result: { ok: boolean; error?: string; data?: unknown }) => Response.json(result, { status: result.ok ? 200 : 400 }),
  requireIOSIdentity: (...args: unknown[]) => mocks.requireIOSIdentity(...args),
  unauthorizedResponse: () => Response.json({ ok: false, error: "Authentication required." }, { status: 401 }),
}));

import { GET, PATCH } from "@/app/api/ios/locations/route";

describe("iOS locations API", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.requireIOSIdentity.mockResolvedValue({
      identity: { userId: "user-a", householdId: "household-a" },
      token: "session-token",
    });
  });

  it("searches for native location suggestions", async () => {
    const paris = {
      id: "2988507",
      name: "Paris",
      admin1: "Île-de-France",
      country: "France",
      latitude: 48.8566,
      longitude: 2.3522,
      timezone: "Europe/Paris",
    };
    mocks.searchLocationsAction.mockResolvedValue({ ok: true, data: [paris] });

    const response = await GET(new NextRequest("https://weekofus.com/api/ios/locations?q=Paris"));

    expect(response.status).toBe(200);
    expect(mocks.searchLocationsAction).toHaveBeenCalledWith("Paris");
    expect(await response.json()).toEqual({ ok: true, data: [paris] });
  });

  it("assigns an existing reusable location", async () => {
    mocks.setDailyLocationAction.mockResolvedValue({ ok: true });
    const input = {
      startDate: "2026-08-14",
      locationId: "20000000-0000-4000-8000-000000000001",
      scope: "through-sunday",
    };

    const response = await PATCH(new NextRequest("https://weekofus.com/api/ios/locations", {
      method: "PATCH",
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
    }));

    expect(response.status).toBe(200);
    expect(mocks.setDailyLocationAction).toHaveBeenCalledWith(input);
    expect(mocks.setGeocodedLocationAction).not.toHaveBeenCalled();
  });

  it("preserves the native choice not to save a searched place for reuse", async () => {
    const input = {
      startDate: "2026-08-14",
      scope: "day",
      saveForReuse: false,
      location: {
        name: "Paris, Île-de-France",
        latitude: 48.8566,
        longitude: 2.3522,
        timezone: "Europe/Paris",
      },
    };
    mocks.setGeocodedLocationAction.mockResolvedValue({
      ok: true,
      data: { id: "20000000-0000-4000-8000-000000000003", ...input.location, isSaved: false },
    });

    const response = await PATCH(new NextRequest("https://weekofus.com/api/ios/locations", {
      method: "PATCH",
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
    }));

    expect(response.status).toBe(200);
    expect(mocks.setGeocodedLocationAction).toHaveBeenCalledWith(input);
    expect(await response.json()).toMatchObject({ ok: true, data: { isSaved: false } });
  });

  it("rejects unauthenticated searches", async () => {
    mocks.requireIOSIdentity.mockResolvedValue(null);

    const response = await GET(new NextRequest("https://weekofus.com/api/ios/locations?q=Paris"));

    expect(response.status).toBe(401);
    expect(mocks.searchLocationsAction).not.toHaveBeenCalled();
  });
});

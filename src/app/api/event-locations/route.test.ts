import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  autocomplete: vi.fn(),
  getUserContext: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/integrations/google-places", () => ({
  GooglePlacesApiError: class GooglePlacesApiError extends Error {
    constructor(message: string, readonly statusCode?: number) { super(message); }
  },
  googlePlacesService: {
    autocomplete: (...args: unknown[]) => mocks.autocomplete(...args),
    resolve: (...args: unknown[]) => mocks.resolve(...args),
  },
}));
vi.mock("@/lib/server/auth", () => ({
  getUserContext: (...args: unknown[]) => mocks.getUserContext(...args),
}));

import { GET, POST } from "@/app/api/event-locations/route";

describe("event location API", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getUserContext.mockResolvedValue({ userId: "user-a", householdId: "household-a" });
  });

  it("returns authenticated autocomplete suggestions with an optional bias", async () => {
    const suggestions = [{ placeId: "place-1", primaryText: "Yankee Stadium", secondaryText: "Bronx, NY", fullText: "Yankee Stadium, Bronx, NY" }];
    mocks.autocomplete.mockResolvedValue(suggestions);
    const token = "00000000-0000-4000-8000-000000000001";

    const result = await GET(new NextRequest(`https://weekofus.com/api/event-locations?q=Yankee&sessionToken=${token}&latitude=40.71&longitude=-74`));

    expect(result.status).toBe(200);
    expect(mocks.autocomplete).toHaveBeenCalledWith("Yankee", token, { latitude: 40.71, longitude: -74 });
    expect(await result.json()).toEqual({ ok: true, data: suggestions });
  });

  it("resolves a selected prediction to finish the billing session", async () => {
    const input = {
      placeId: "place-1",
      sessionToken: "00000000-0000-4000-8000-000000000001",
      suggestedText: "Yankee Stadium, Bronx, NY",
    };
    mocks.resolve.mockResolvedValue({ placeId: "place-1", location: input.suggestedText, formattedAddress: "1 E 161st St, Bronx, NY" });

    const result = await POST(new NextRequest("https://weekofus.com/api/event-locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }));

    expect(result.status).toBe(200);
    expect(mocks.resolve).toHaveBeenCalledWith(input.placeId, input.sessionToken, input.suggestedText);
  });

  it("rejects unauthenticated autocomplete requests", async () => {
    mocks.getUserContext.mockResolvedValue(null);

    const result = await GET(new NextRequest("https://weekofus.com/api/event-locations?q=Yankee&sessionToken=00000000-0000-4000-8000-000000000001"));

    expect(result.status).toBe(401);
    expect(mocks.autocomplete).not.toHaveBeenCalled();
  });

  it("requires latitude and longitude together", async () => {
    const result = await GET(new NextRequest("https://weekofus.com/api/event-locations?q=Yankee&sessionToken=00000000-0000-4000-8000-000000000001&latitude=40.71"));

    expect(result.status).toBe(400);
    expect(mocks.autocomplete).not.toHaveBeenCalled();
  });
});

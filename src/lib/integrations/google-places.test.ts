import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GooglePlacesApiError, GooglePlacesService } from "@/lib/integrations/google-places";

describe("GooglePlacesService", () => {
  const originalKey = process.env.GOOGLE_PLACES_API_KEY;

  beforeEach(() => {
    process.env.GOOGLE_PLACES_API_KEY = "places-key";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = originalKey;
    vi.unstubAllGlobals();
  });

  it("maps place predictions and sends the household location bias", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      suggestions: [{
        placePrediction: {
          placeId: "place-1",
          text: { text: "Yankee Stadium, East 161st Street, Bronx, NY, USA" },
          structuredFormat: {
            mainText: { text: "Yankee Stadium" },
            secondaryText: { text: "East 161st Street, Bronx, NY, USA" },
          },
        },
      }],
    }), { status: 200 }));

    const service = new GooglePlacesService();
    const results = await service.autocomplete("Yankee Sta", "00000000-0000-4000-8000-000000000001", {
      latitude: 40.71,
      longitude: -74,
    });

    expect(results).toEqual([{
      placeId: "place-1",
      primaryText: "Yankee Stadium",
      secondaryText: "East 161st Street, Bronx, NY, USA",
      fullText: "Yankee Stadium, East 161st Street, Bronx, NY, USA",
    }]);
    const [, request] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      input: "Yankee Sta",
      sessionToken: "00000000-0000-4000-8000-000000000001",
      locationBias: { circle: { center: { latitude: 40.71, longitude: -74 }, radius: 50_000 } },
    });
    expect(new Headers(request?.headers).get("X-Goog-Api-Key")).toBe("places-key");
  });

  it("terminates the autocomplete session with Place Details and preserves the selected label", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      id: "place-1",
      formattedAddress: "1 E 161st St, Bronx, NY 10451, USA",
    }), { status: 200 }));

    const service = new GooglePlacesService();
    const resolved = await service.resolve(
      "place-1",
      "00000000-0000-4000-8000-000000000001",
      "Yankee Stadium, East 161st Street, Bronx, NY, USA",
    );

    expect(resolved).toEqual({
      placeId: "place-1",
      location: "Yankee Stadium, East 161st Street, Bronx, NY, USA",
      formattedAddress: "1 E 161st St, Bronx, NY 10451, USA",
    });
    const [url, request] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("/places/place-1?sessionToken=00000000-0000-4000-8000-000000000001");
    expect(new Headers(request?.headers).get("X-Goog-FieldMask")).toBe("id,formattedAddress");
  });

  it("fails closed when the server-only API key is missing", async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;

    await expect(new GooglePlacesService().autocomplete("Yankee", "00000000-0000-4000-8000-000000000001"))
      .rejects.toBeInstanceOf(GooglePlacesApiError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

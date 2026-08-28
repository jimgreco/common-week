import "server-only";

import type { EventLocationSuggestion, ResolvedEventLocation } from "@/types/domain";

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const AUTOCOMPLETE_FIELDS = [
  "suggestions.placePrediction.placeId",
  "suggestions.placePrediction.text.text",
  "suggestions.placePrediction.structuredFormat.mainText.text",
  "suggestions.placePrediction.structuredFormat.secondaryText.text",
].join(",");

interface GoogleAutocompleteResponse {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
  }>;
}

interface GooglePlaceDetailsResponse {
  id?: string;
  formattedAddress?: string;
}

export interface EventLocationBias {
  latitude: number;
  longitude: number;
}

export class GooglePlacesApiError extends Error {
  constructor(message: string, readonly statusCode?: number) {
    super(message);
    this.name = "GooglePlacesApiError";
  }
}

function apiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!key) throw new GooglePlacesApiError("Event location suggestions are not configured.");
  return key;
}

async function placesRequest(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(6_000),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new GooglePlacesApiError("Google Maps location suggestions are temporarily unavailable.", response.status);
  }
  return response;
}

export class GooglePlacesService {
  async autocomplete(input: string, sessionToken: string, bias?: EventLocationBias): Promise<EventLocationSuggestion[]> {
    const body: Record<string, unknown> = {
      input,
      languageCode: "en",
      sessionToken,
    };
    if (bias) {
      body.locationBias = {
        circle: {
          center: bias,
          radius: 50_000,
        },
      };
    }

    const response = await placesRequest(AUTOCOMPLETE_URL, {
      method: "POST",
      headers: { "X-Goog-FieldMask": AUTOCOMPLETE_FIELDS },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as GoogleAutocompleteResponse;
    return (payload.suggestions ?? []).flatMap((suggestion) => {
      const prediction = suggestion.placePrediction;
      const placeId = prediction?.placeId?.trim();
      const fullText = prediction?.text?.text?.trim();
      const primaryText = prediction?.structuredFormat?.mainText?.text?.trim();
      const secondaryText = prediction?.structuredFormat?.secondaryText?.text?.trim() ?? "";
      if (!placeId || !fullText || !primaryText) return [];
      return [{
        placeId,
        primaryText,
        secondaryText,
        fullText,
      }];
    });
  }

  async resolve(placeId: string, sessionToken: string, suggestedText: string): Promise<ResolvedEventLocation> {
    const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
    url.searchParams.set("sessionToken", sessionToken);
    url.searchParams.set("languageCode", "en");
    const response = await placesRequest(url.toString(), {
      method: "GET",
      headers: { "X-Goog-FieldMask": "id,formattedAddress" },
    });
    const place = (await response.json()) as GooglePlaceDetailsResponse;
    if (!place.id || !place.formattedAddress) {
      throw new GooglePlacesApiError("Google Maps returned an incomplete location.");
    }
    return {
      placeId: place.id,
      location: suggestedText,
      formattedAddress: place.formattedAddress,
    };
  }
}

export const googlePlacesService = new GooglePlacesService();

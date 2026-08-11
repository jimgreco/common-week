import "server-only";

import type { GeocodingResult } from "@/types/domain";

export interface GeocodingService {
  search(query: string): Promise<GeocodingResult[]>;
}

interface OpenMeteoGeocodingResponse {
  results?: Array<{
    id: number;
    name: string;
    admin1?: string;
    country?: string;
    latitude: number;
    longitude: number;
    timezone: string;
  }>;
}

export class OpenMeteoGeocodingService implements GeocodingService {
  async search(query: string): Promise<GeocodingResult[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2 || trimmed.length > 120) return [];

    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", trimmed);
    url.searchParams.set("count", "8");
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");

    const response = await fetch(url, {
      signal: AbortSignal.timeout(6_000),
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Location search is temporarily unavailable.");

    const payload = (await response.json()) as OpenMeteoGeocodingResponse;
    return (payload.results ?? [])
      .filter((result) => result.timezone && Number.isFinite(result.latitude) && Number.isFinite(result.longitude))
      .map((result) => ({
        id: String(result.id),
        name: result.name,
        admin1: result.admin1,
        country: result.country,
        latitude: result.latitude,
        longitude: result.longitude,
        timezone: result.timezone,
      }));
  }
}

export const geocodingService: GeocodingService = new OpenMeteoGeocodingService();

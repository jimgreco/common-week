import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { OpenMeteoWeatherProvider } from "./weather";

const location = { id: "paris", name: "Paris", latitude: 48.85, longitude: 2.35, timezone: "Europe/Paris", isSaved: true };
const forecast = () => ({ daily: { time: ["2026-09-14"], weather_code: [3], temperature_2m_max: [72], temperature_2m_min: [58], precipitation_probability_max: [60], precipitation_sum: [0.2], wind_speed_10m_max: [12], sunrise: ["2026-09-14T07:00"], sunset: ["2026-09-14T20:00"] }, hourly: { time: ["2026-09-14T09:00"], temperature_2m: [68], precipitation_probability: [60], precipitation: [0.12], weather_code: [3], wind_speed_10m: [11] } });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-14T12:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Open-Meteo hourly contracts", () => {
  it("requests explicit units and retains hourly rain amount and wind", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(forecast())); vi.stubGlobal("fetch", fetcher);
    const result = await new OpenMeteoWeatherProvider().getDailyForecast(location, "2026-09-14", "2026-09-14");
    expect(result.get("2026-09-14")?.hourly[0]).toMatchObject({ temperatureF: 68, precipitationAmount: 0.12, windSpeedMph: 11 });
    const url = fetcher.mock.calls[0][0] as URL;
    expect(url.searchParams.get("precipitation_unit")).toBe("inch"); expect(url.searchParams.get("wind_speed_unit")).toBe("mph");
  });
  it("keeps missing fields unknown instead of fabricating zero rain and wind", async () => {
    const partial = { ...forecast(), hourly: { time: ["2026-09-14T09:00"], temperature_2m: [null], precipitation_probability: [null] } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(partial)));
    const result = await new OpenMeteoWeatherProvider().getDailyForecast(location, "2026-09-14", "2026-09-14");
    expect(result.get("2026-09-14")?.hourly[0]).toEqual({ time: "2026-09-14T09:00", temperatureF: null, precipitationProbability: null, precipitationAmount: null, windSpeedMph: null, conditionCode: null });
  });
  it("does not fetch or fabricate past or beyond-horizon forecasts", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const provider = new OpenMeteoWeatherProvider();
    expect((await provider.getDailyForecast(location, "2026-08-01", "2026-08-01")).get("2026-08-01")?.status).toBe("unavailable");
    expect((await provider.getDailyForecast(location, "2027-01-01", "2027-01-01")).get("2027-01-01")?.hourly).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reports provider failure instead of a forecast", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(new OpenMeteoWeatherProvider().getDailyForecast(location, "2026-09-14", "2026-09-14")).rejects.toThrow("503");
  });
});

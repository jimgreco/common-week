import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), forecast: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/database", () => ({ query: mocks.query }));
vi.mock("@/lib/integrations/weather", () => ({ weatherProvider: { getDailyForecast: mocks.forecast } }));
import { getWeatherForAssignments } from "./weather-data";
const location = { id: "home", name: "Home", latitude: 40, longitude: -73, timezone: "America/New_York", isSaved: true };
const daily = { date: "2026-09-14", locationId: "home", status: "available", highF: 70, lowF: 60 };
beforeEach(() => { mocks.query.mockReset(); mocks.forecast.mockReset(); });
describe("weather cache and provider isolation", () => {
  it("shares cached forecasts across household members without provider calls", async () => {
    mocks.query.mockResolvedValue({ rows: [{ daily, hourly: [] }] });
    const result = await getWeatherForAssignments([{ date: "2026-09-14", location }, { date: "2026-09-14", location }]);
    expect(result.state.status).toBe("ready"); expect(result.forecasts.size).toBe(1);
    expect(mocks.forecast).not.toHaveBeenCalled();
  });
  it("retains cached days when a missing day's provider request fails", async () => {
    mocks.query.mockResolvedValue({ rows: [{ daily, hourly: [] }] });
    mocks.forecast.mockRejectedValue(new Error("timeout"));
    const result = await getWeatherForAssignments([{ date: "2026-09-14", location }, { date: "2026-09-15", location }, { date: "2026-09-15", location }]);
    expect(result.state.status).toBe("error"); expect(result.forecasts.get("home:2026-09-14")).toMatchObject(daily);
    expect(result.forecasts.has("home:2026-09-15")).toBe(false);
    expect(mocks.forecast).toHaveBeenCalledExactlyOnceWith(location, "2026-09-15", "2026-09-15");
  });
});

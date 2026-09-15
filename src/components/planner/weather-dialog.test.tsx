import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WeatherDialog } from "./dialogs";
import type { DayPlan } from "@/types/domain";
vi.mock("@/app/actions/planner", () => ({ searchLocationsAction: vi.fn() }));
const day: DayPlan = { date: "2026-09-14", items: [], events: [], memberLocations: [], location: null, weather: { date: "2026-09-14", locationId: "home", status: "available", conditionCode: 3, highF: 75, lowF: 60, precipitationProbability: 50, precipitationAmount: 0.2, windSpeedMph: 16, sunrise: "2026-09-14T06:30", sunset: "2026-09-14T19:00", hourly: [{ time: "2026-09-14T09:00", temperatureF: 68, precipitationProbability: 50, precipitationAmount: 0.12, windSpeedMph: 12, conditionCode: 3 }] } };
describe("hourly weather details", () => {
  it.each([["fahrenheit", "68°F"], ["celsius", "20°C"]] as const)("shows complete hourly values in %s with accessible units", (unit, temperature) => {
    render(<WeatherDialog day={day} timeZone="America/New_York" temperatureUnit={unit} onClose={vi.fn()} />);
    expect(screen.getByText("9:00 AM")).toBeInTheDocument();
    expect(screen.getByLabelText(`Temperature ${temperature}`)).toBeInTheDocument();
    expect(screen.getByLabelText("Expected precipitation 0.12 in")).toBeInTheDocument();
    expect(screen.getByLabelText("Wind 12 mph")).toBeInTheDocument();
    expect(screen.getByText(/Sunrise/)).toBeInTheDocument(); expect(screen.getByText(/Sunset/)).toBeInTheDocument();
  });
  it("shows missing hourly fields as an em dash", () => {
    const partial = { ...day, weather: { ...day.weather!, hourly: [{ time: "2026-09-14T09:00", temperatureF: null, precipitationProbability: null, precipitationAmount: null, windSpeedMph: null, conditionCode: null }] } };
    render(<WeatherDialog day={partial} timeZone="America/New_York" temperatureUnit="fahrenheit" onClose={vi.fn()} />);
    expect(screen.getByLabelText("Expected precipitation —")).toHaveTextContent("—");
    expect(screen.getByLabelText("Wind —")).toHaveTextContent("—");
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
  it.each(["error", "unavailable"] as const)("does not display a fabricated %s forecast", (status) => {
    const { container } = render(<WeatherDialog day={{ ...day, weather: { ...day.weather!, status } }} timeZone="America/New_York" temperatureUnit="fahrenheit" onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

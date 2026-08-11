import "server-only";

import { todayInTimeZone } from "@/lib/date";
import { forecastWindow } from "@/lib/weather-window";
import type { DailyWeather, HouseholdLocation, HourlyWeather } from "@/types/domain";

export interface WeatherProvider {
  getDailyForecast(
    location: HouseholdLocation,
    startDate: string,
    endDate: string,
  ): Promise<Map<string, DailyWeather>>;
}

interface OpenMeteoResponse {
  daily?: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
    precipitation_sum: number[];
    wind_speed_10m_max: number[];
    sunrise: string[];
    sunset: string[];
  };
  hourly?: {
    time: string[];
    temperature_2m: number[];
    precipitation_probability: number[];
    precipitation: number[];
    weather_code: number[];
    wind_speed_10m: number[];
  };
}

function unavailableForecast(date: string, locationId: string): DailyWeather {
  return {
    date,
    locationId,
    conditionCode: 0,
    highF: 0,
    lowF: 0,
    precipitationProbability: 0,
    precipitationAmount: 0,
    windSpeedMph: 0,
    sunrise: "",
    sunset: "",
    hourly: [],
    status: "unavailable",
  };
}

export class OpenMeteoWeatherProvider implements WeatherProvider {
  async getDailyForecast(
    location: HouseholdLocation,
    startDate: string,
    endDate: string,
  ): Promise<Map<string, DailyWeather>> {
    const results = new Map<string, DailyWeather>();
    const today = todayInTimeZone(location.timezone);
    const window = forecastWindow(startDate, endDate, today);
    for (const date of window.unavailableDates) results.set(date, unavailableForecast(date, location.id));
    if (!window.requestStart || !window.requestEnd) return results;

    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(location.latitude));
    url.searchParams.set("longitude", String(location.longitude));
    url.searchParams.set("timezone", location.timezone);
    url.searchParams.set("start_date", window.requestStart);
    url.searchParams.set("end_date", window.requestEnd);
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("wind_speed_unit", "mph");
    url.searchParams.set("precipitation_unit", "inch");
    url.searchParams.set(
      "daily",
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,sunrise,sunset",
    );
    url.searchParams.set(
      "hourly",
      "temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m",
    );

    const response = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Weather provider returned ${response.status}.`);
    }

    const payload = (await response.json()) as OpenMeteoResponse;
    if (!payload.daily || !payload.hourly) {
      throw new Error("Weather provider returned an incomplete forecast.");
    }

    const hoursByDate = new Map<string, HourlyWeather[]>();
    payload.hourly.time.forEach((time, index) => {
      const date = time.slice(0, 10);
      const hours = hoursByDate.get(date) ?? [];
      hours.push({
        time,
        temperatureF: Math.round(payload.hourly!.temperature_2m[index]),
        precipitationProbability: Math.round(payload.hourly!.precipitation_probability[index] ?? 0),
        precipitationAmount: payload.hourly!.precipitation[index] ?? 0,
        conditionCode: payload.hourly!.weather_code[index] ?? 0,
        windSpeedMph: Math.round(payload.hourly!.wind_speed_10m[index] ?? 0),
      });
      hoursByDate.set(date, hours);
    });

    payload.daily.time.forEach((date, index) => {
      results.set(date, {
        date,
        locationId: location.id,
        conditionCode: payload.daily!.weather_code[index] ?? 0,
        highF: Math.round(payload.daily!.temperature_2m_max[index]),
        lowF: Math.round(payload.daily!.temperature_2m_min[index]),
        precipitationProbability: Math.round(payload.daily!.precipitation_probability_max[index] ?? 0),
        precipitationAmount: payload.daily!.precipitation_sum[index] ?? 0,
        windSpeedMph: Math.round(payload.daily!.wind_speed_10m_max[index] ?? 0),
        sunrise: payload.daily!.sunrise[index] ?? "",
        sunset: payload.daily!.sunset[index] ?? "",
        hourly: hoursByDate.get(date) ?? [],
        status: "available",
      });
    });

    return results;
  }
}

export const weatherProvider: WeatherProvider = new OpenMeteoWeatherProvider();

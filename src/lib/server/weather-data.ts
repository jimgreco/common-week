import "server-only";

import { weatherProvider } from "@/lib/integrations/weather";
import { query } from "@/lib/server/database";
import type { DailyWeather, HouseholdLocation, PlannerSourceState } from "@/types/domain";

interface WeatherBundle {
  forecasts: Map<string, DailyWeather>;
  state: PlannerSourceState;
}

function weatherFromCache(row: { daily: unknown; hourly: unknown }): DailyWeather | null {
  if (!row.daily || typeof row.daily !== "object" || !Array.isArray(row.hourly)) return null;
  const daily = row.daily as Omit<DailyWeather, "hourly">;
  if (daily.status !== "available" || typeof daily.date !== "string" || typeof daily.locationId !== "string") return null;
  return { ...daily, hourly: row.hourly as DailyWeather["hourly"] };
}

export async function getWeatherForAssignments(
  assignments: Array<{ date: string; location: HouseholdLocation | null }>,
): Promise<WeatherBundle> {
  const forecasts = new Map<string, DailyWeather>();
  const byLocation = new Map<string, { location: HouseholdLocation; dates: string[] }>();

  for (const assignment of assignments) {
    if (!assignment.location) continue;
    const current = byLocation.get(assignment.location.id) ?? { location: assignment.location, dates: [] };
    current.dates.push(assignment.date);
    byLocation.set(assignment.location.id, current);
  }

  try {
    const results = await Promise.all(
      [...byLocation.values()].map(async ({ location, dates }) => {
        const sorted = [...dates].sort();
        const loaded = new Map<string, DailyWeather>();
        try {
          const cached = await query<{ daily: unknown; hourly: unknown }>(
            `select daily, hourly from weather_cache
              where location_id = $1 and forecast_date = any($2::date[]) and expires_at > now()`,
            [location.id, sorted],
          );
          for (const row of cached.rows) {
            const forecast = weatherFromCache(row);
            if (forecast) loaded.set(forecast.date, forecast);
          }
        } catch {
          // A cache miss or cache outage should never hide a live forecast.
        }

        const missing = sorted.filter((date) => !loaded.has(date));
        const fresh = new Map<string, DailyWeather>();
        if (missing.length) {
          try {
            const fetched = await weatherProvider.getDailyForecast(location, missing[0], missing.at(-1)!);
            for (const date of missing) {
              const forecast = fetched.get(date);
              if (forecast) {
                loaded.set(date, forecast);
                fresh.set(date, forecast);
              }
            }
          } catch {
            return { location, dates, loaded, fresh, failed: true };
          }
        }
        return { location, dates, loaded, fresh, failed: false };
      }),
    );

    let failed = false;
    for (const result of results) {
      const { location, dates, loaded, fresh } = result;
      failed ||= result.failed;
      for (const date of dates) {
        const forecast = loaded.get(date);
        if (forecast) forecasts.set(`${location.id}:${date}`, forecast);
      }

      try {
        for (const forecast of fresh.values()) {
          if (forecast.status !== "available") continue;
          await query(
            `insert into weather_cache (
               location_id, forecast_date, daily, hourly, fetched_at, expires_at
             ) values ($1, $2::date, $3::jsonb, $4::jsonb, now(), $5)
             on conflict (location_id, forecast_date) do update set
               daily = excluded.daily,
               hourly = excluded.hourly,
               fetched_at = excluded.fetched_at,
               expires_at = excluded.expires_at`,
            [
              location.id,
              forecast.date,
              JSON.stringify({ ...forecast, hourly: [] }),
              JSON.stringify(forecast.hourly),
              new Date(Date.now() + 2 * 60 * 60_000),
            ],
          );
        }
      } catch {
        // Caching is an optimization; a fresh provider result remains usable.
      }
    }

    return {
      forecasts,
      state: failed
        ? { status: "error", message: "Weather is unavailable for one or more locations." }
        : { status: "ready" },
    };
  } catch {
    return { forecasts, state: { status: "error", message: "Weather unavailable." } };
  }
}

import "server-only";

import { weatherProvider } from "@/lib/integrations/weather";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DailyWeather, HouseholdLocation, PlannerSourceState } from "@/types/domain";

interface WeatherBundle {
  forecasts: Map<string, DailyWeather>;
  state: PlannerSourceState;
}

function weatherFromCache(row: Record<string, unknown>): DailyWeather | null {
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
    const admin = createAdminClient();
    const now = new Date().toISOString();
    const results = await Promise.all(
      [...byLocation.values()].map(async ({ location, dates }) => {
        const sorted = [...dates].sort();
        const loaded = new Map<string, DailyWeather>();

        try {
          const { data: cached } = await admin
            .from("weather_cache")
            .select("daily, hourly")
            .eq("location_id", location.id)
            .in("forecast_date", sorted)
            .gt("expires_at", now);
          for (const row of (cached ?? []) as Array<Record<string, unknown>>) {
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
        const cacheRows = [...fresh.values()]
          .filter((forecast) => forecast.status === "available")
          .map((forecast) => ({
            location_id: location.id,
            forecast_date: forecast.date,
            daily: { ...forecast, hourly: [] },
            hourly: forecast.hourly,
            fetched_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
          }));
        if (cacheRows.length) {
          await admin.from("weather_cache").upsert(cacheRows, {
            onConflict: "location_id,forecast_date",
          });
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

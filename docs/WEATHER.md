# Weather and geocoding

Week of Us uses Open-Meteo without a client-side API key. All provider calls happen through server modules and are normalized into internal domain types.

## Provider boundaries

- `src/lib/integrations/weather.ts` implements `WeatherProvider.getDailyForecast()`.
- `src/lib/integrations/geocoding.ts` implements `GeocodingService.search()`.
- The rest of the app consumes `DailyWeather`, `HourlyWeather`, and `GeocodingResult`; it never depends on Open-Meteo response objects.

The weather request explicitly supplies latitude, longitude, the location's IANA timezone, Fahrenheit, mph, and inches. Celsius households receive converted display values without changing the normalized cache representation.

## Forecast behavior

- Each day's explicit location wins; otherwise it inherits the household default.
- Current and upcoming forecasts are cached in PostgreSQL for two hours by location and date.
- A location change changes the cache key immediately, so the new place is fetched independently.
- Dates before “today” in the location timezone are not fetched.
- Dates more than 15 days ahead are returned as unavailable and display “Forecast not yet available.” No climate averages or fabricated forecasts are used.
- One location/provider failure produces a weather-only error state; Calendar and planning data continue rendering.

The summary shows condition, high, low, and maximum precipitation probability. The detail sheet shows practical daytime hourly temperature/rain, total precipitation, peak wind, sunrise, and sunset.

## Replacing the provider

Implement the `WeatherProvider` or `GeocodingService` interface, normalize into the existing domain types, and swap the exported instance. Keep provider credentials and raw payloads out of Client Components.

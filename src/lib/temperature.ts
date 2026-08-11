export type TemperatureUnit = "fahrenheit" | "celsius";

export function displayTemperature(fahrenheit: number, unit: TemperatureUnit): number {
  return unit === "celsius" ? Math.round((fahrenheit - 32) * (5 / 9)) : Math.round(fahrenheit);
}

export function temperatureSymbol(unit: TemperatureUnit): string {
  return unit === "celsius" ? "°C" : "°F";
}

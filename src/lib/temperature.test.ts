import { describe, expect, it } from "vitest";
import { displayTemperature, temperatureSymbol } from "@/lib/temperature";

describe("temperature display", () => {
  it("leaves Fahrenheit values in Fahrenheit", () => {
    expect(displayTemperature(82, "fahrenheit")).toBe(82);
    expect(temperatureSymbol("fahrenheit")).toBe("°F");
  });

  it("converts provider Fahrenheit values for Celsius households", () => {
    expect(displayTemperature(32, "celsius")).toBe(0);
    expect(displayTemperature(82, "celsius")).toBe(28);
    expect(temperatureSymbol("celsius")).toBe("°C");
  });
});

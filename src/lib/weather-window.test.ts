import { describe, expect, it } from "vitest";
import { forecastWindow } from "@/lib/weather-window";

describe("forecast availability", () => {
  it("never requests past dates or dates beyond the forecast horizon", () => {
    const window = forecastWindow("2026-08-08", "2026-08-28", "2026-08-10");
    expect(window.requestStart).toBe("2026-08-10");
    expect(window.requestEnd).toBe("2026-08-25");
    expect(window.unavailableDates).toContain("2026-08-08");
    expect(window.unavailableDates).toContain("2026-08-28");
  });

  it("skips provider retrieval for an entirely past range", () => {
    expect(forecastWindow("2026-08-01", "2026-08-07", "2026-08-10")).toMatchObject({
      requestStart: null,
      requestEnd: null,
    });
  });
});

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlannerSource } from "./use-planner-source";

function deferred() {
  let resolve!: (value: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const payload = (label: string) => ({ ok: true, data: { days: [], calendarState: { status: "ready", message: label }, weatherState: { status: "ready" } } });
afterEach(() => vi.unstubAllGlobals());

describe("independent planner sources", () => {
  it.each(["calendar", "weather"] as const)("delivers %s without waiting for the other provider", async (first) => {
    const calendar = deferred(); const weather = deferred();
    const fetcher = vi.fn((url: string) => url.includes("source=calendar") ? calendar.promise : weather.promise);
    vi.stubGlobal("fetch", fetcher);
    const onCalendar = vi.fn(); const onWeather = vi.fn();
    const { rerender } = renderHook(() => {
      usePlannerSource("calendar", "2026-09-14", "calendars", true, onCalendar);
      usePlannerSource("weather", "2026-09-14", "locations", true, onWeather);
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await act(async () => { (first === "calendar" ? calendar : weather).resolve(Response.json(payload(first))); });
    expect(first === "calendar" ? onCalendar : onWeather).toHaveBeenCalledWith(payload(first));
    expect(first === "calendar" ? onWeather : onCalendar).not.toHaveBeenCalled();
    rerender();
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => { (first === "calendar" ? weather : calendar).reject(new TypeError("offline")); });
    expect(first === "calendar" ? onCalendar : onWeather).toHaveBeenCalledTimes(1);
    expect(first === "calendar" ? onWeather : onCalendar).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: expect.stringContaining("Connection interrupted") }));
  });

  it("turns an HTML server error into a readable retry message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<h1>Bad gateway</h1>", { status: 502 })));
    const receive = vi.fn();
    renderHook(() => usePlannerSource("calendar", "2026-09-14", "calendars", true, receive));
    await waitFor(() => expect(receive).toHaveBeenCalledWith({ ok: false, error: "Calendar could not be refreshed. Try again." }));
  });

  it("aborts and ignores stale week/location responses and supports retry", async () => {
    const old = deferred(); const next = deferred();
    const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise).mockResolvedValue(Response.json(payload("retry")));
    vi.stubGlobal("fetch", fetcher);
    const receive = vi.fn();
    const { result, rerender, unmount } = renderHook(({ week, location }) => usePlannerSource("weather", week, location, true, receive), { initialProps: { week: "2026-09-14", location: "Paris" } });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
    rerender({ week: "2026-09-21", location: "New York" });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(signal.aborted).toBe(true);
    await act(async () => { old.resolve(Response.json(payload("stale"))); next.resolve(Response.json(payload("new"))); });
    expect(receive).toHaveBeenCalledTimes(1);
    expect(receive).toHaveBeenLastCalledWith(payload("new"));
    await act(async () => { await result.current(); });
    expect(receive).toHaveBeenLastCalledWith(payload("retry"));
    const lastSignal = fetcher.mock.calls[2][1].signal as AbortSignal;
    unmount();
    expect(lastSignal.aborted).toBe(true);
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarTimeline } from "./calendar-timeline";
import { getDemoPlannerData } from "@/lib/demo-data";
const data = getDemoPlannerData();
const day = data.days[0];
const event = { ...day.events[0], canEdit: true };
const props = () => ({ days: [{ ...day, events: [event] }], timeZone: data.household.timezone, sourceState: data.calendarState, onEvent: vi.fn(), onDay: vi.fn(), onCreate: vi.fn(), onMove: vi.fn().mockResolvedValue(null), canCreate: true, children: null });
beforeEach(() => { vi.stubGlobal("PointerEvent", MouseEvent); HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.scrollBy = vi.fn(); });
describe("calendar creation and moving", () => {
  it("opens the date and clicked quarter hour, or an all-day draft", () => {
    const callbacks = props(); render(<CalendarTimeline {...callbacks} />);
    const surface = screen.getByRole("button", { name: `Add event on ${day.date}` });
    fireEvent.click(surface, { clientY: 10.5 * 72, detail: 1 });
    expect(callbacks.onCreate).toHaveBeenCalledWith({ date: day.date, minute: 630 });
    fireEvent.click(screen.getByRole("button", { name: `Add all-day event on ${day.date}` }));
    expect(callbacks.onCreate).toHaveBeenLastCalledWith({ date: day.date, minute: null });
  });
  it("moves after dragging, suppresses the details click, and reports a save failure", async () => {
    const callbacks = props(); callbacks.onMove.mockResolvedValue("The event changed in Google. Refresh and try again.");
    const { container } = render(<CalendarTimeline {...callbacks} />);
    const column = container.querySelector(".timeline-day")!;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => column) });
    const button = screen.getByRole("button", { name: new RegExp(`^${event.title} ·`) });
    fireEvent.pointerDown(button, { button: 0, clientX: 100, clientY: 9.25 * 72 });
    fireEvent.pointerMove(button, { clientX: 100, clientY: 11.25 * 72 });
    fireEvent.pointerUp(button); fireEvent.click(button);
    await waitFor(() => expect(callbacks.onMove).toHaveBeenCalledTimes(1));
    expect(callbacks.onMove.mock.calls[0][1]).toEqual({ date: day.date, minute: 675 });
    expect(callbacks.onEvent).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent("event changed in Google");
  });
  it("leaves read-only events inspectable and disables creation without writable calendars", () => {
    const callbacks = props(); render(<CalendarTimeline {...callbacks} canCreate={false} days={[{ ...day, events: [{ ...event, canEdit: false }] }]} />);
    const button = screen.getByRole("button", { name: new RegExp(`^${event.title} ·`) });
    fireEvent.pointerDown(button, { button: 0, clientX: 100, clientY: 100 }); fireEvent.pointerMove(button, { clientX: 100, clientY: 200 }); fireEvent.pointerUp(button); fireEvent.click(button);
    expect(callbacks.onMove).not.toHaveBeenCalled(); expect(callbacks.onEvent).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: `Add event on ${day.date}` })).not.toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventDetailDialog, LocationDialog } from "@/components/planner/dialogs";
import type { CalendarEvent } from "@/types/domain";

const searchLocationsAction = vi.fn();

vi.mock("@/app/actions/planner", () => ({
  searchLocationsAction: (...args: unknown[]) => searchLocationsAction(...args),
}));

describe("LocationDialog", () => {
  beforeEach(() => {
    searchLocationsAction.mockReset();
  });

  it("finds and selects an autocomplete result without requiring a saved location", async () => {
    searchLocationsAction.mockResolvedValue({
      ok: true,
      data: [{
        id: "2988507",
        name: "Paris",
        admin1: "Île-de-France",
        country: "France",
        latitude: 48.8566,
        longitude: 2.3522,
        timezone: "Europe/Paris",
      }],
    });
    const onSave = vi.fn().mockResolvedValue(null);

    render(
      <LocationDialog
        date="2026-08-10"
        locations={[]}
        currentLocationId={null}
        isDemo={false}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    const search = screen.getByRole("combobox", { name: "Search for a city or place" });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "Paris" } });
    const suggestion = await screen.findByRole("option", { name: /Paris.*Île-de-France, France/ }, { timeout: 1_500 });
    fireEvent.click(suggestion);

    expect(screen.getByText("Selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set location" })).toBeEnabled();
    fireEvent.click(screen.getByText("This day through Sunday"));
    fireEvent.click(screen.getByRole("button", { name: "Set location" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      {
        kind: "search",
        name: "Paris, Île-de-France",
        result: expect.objectContaining({ id: "2988507", timezone: "Europe/Paris" }),
      },
      "through-sunday",
    ));
  });

  it("keeps the dialog open and displays an assignment failure", async () => {
    const onSave = vi.fn().mockResolvedValue("Location changes could not be saved.");

    render(
      <LocationDialog
        date="2026-08-10"
        locations={[{
          id: "location-1",
          name: "Manhattan",
          latitude: 40.7831,
          longitude: -73.9712,
          timezone: "America/New_York",
          isSaved: true,
        }]}
        currentLocationId="location-1"
        isDemo={false}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Set location" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Location changes could not be saved.");
    expect(screen.getByRole("dialog", { name: "Set location · Monday" })).toBeInTheDocument();
  });
});

describe("EventDetailDialog", () => {
  it("shows event details, explains conflicts, and supports hiding", async () => {
    const event: CalendarEvent = {
      id: "family:event-1",
      title: "Dinner reservation",
      description: "Patio table requested.",
      location: "177 Main Street",
      googleUrl: "https://calendar.google.com/event?eid=example",
      start: "2026-08-15T19:00:00-04:00",
      end: "2026-08-15T21:00:00-04:00",
      allDay: false,
      calendarId: "family",
      calendarName: "Family",
      calendarAlias: "Family",
      calendarColor: "#688173",
      attribution: "FA",
      isConflict: true,
    };
    const onHide = vi.fn().mockResolvedValue(null);

    render(<EventDetailDialog event={event} timeZone="America/New_York" onClose={vi.fn()} onHide={onHide} />);

    expect(screen.getByRole("dialog", { name: "Calendar event" })).toBeInTheDocument();
    expect(screen.getByText("Dinner reservation")).toBeInTheDocument();
    expect(screen.getByText("Saturday, August 15 · 7:00 PM–9:00 PM")).toBeInTheDocument();
    expect(screen.getByText("177 Main Street")).toBeInTheDocument();
    expect(screen.getByText("Time conflict")).toBeInTheDocument();
    expect(screen.getByText("This event overlaps another scheduled event.")).toBeInTheDocument();
    expect(screen.getByText("Patio table requested.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide from Common Week" }));
    await waitFor(() => expect(onHide).toHaveBeenCalledWith(event));
  });
});

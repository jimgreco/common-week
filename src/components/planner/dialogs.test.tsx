import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarEventEditorDialog, EventDetailDialog, LocationDialog } from "@/components/planner/dialogs";
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
      sectionGroup: "critical",
      isConflict: true,
    };
    const onHide = vi.fn().mockResolvedValue(null);

    render(<EventDetailDialog event={event} timeZone="America/New_York" onClose={vi.fn()} onHide={onHide} onEdit={vi.fn()} />);

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

describe("CalendarEventEditorDialog", () => {
  const calendars = [{
    id: "00000000-0000-4000-8000-000000000001",
    name: "Family",
    color: "#688173",
    sectionGroup: "critical" as const,
  }];

  it("keeps entered content visible when a Google save fails", async () => {
    const onSave = vi.fn().mockResolvedValue("Google Calendar could not save this change. Your edits are still here.");
    render(<CalendarEventEditorDialog date="2026-08-15" calendars={calendars} timeZone="America/New_York" onClose={vi.fn()} onSave={onSave} onDelete={vi.fn()} />);

    const title = screen.getByRole("textbox", { name: "Title" });
    fireEvent.change(title, { target: { value: "Dinner outside" } });
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "The patio" } });
    fireEvent.click(screen.getByRole("button", { name: "Add event" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Your edits are still here");
    expect(title).toHaveValue("Dinner outside");
    expect(screen.getByLabelText("Location")).toHaveValue("The patio");
  });

  it("requires explicit confirmation before deleting from Google", async () => {
    const event: CalendarEvent = {
      id: "family:event-1",
      providerEventId: "event-1",
      calendarPreferenceId: calendars[0].id,
      etag: "etag-1",
      canEdit: true,
      title: "Dinner reservation",
      start: "2026-08-15T19:00:00-04:00",
      end: "2026-08-15T21:00:00-04:00",
      allDay: false,
      calendarId: "family",
      calendarName: "Family",
      calendarAlias: "Family",
      calendarColor: "#688173",
      attribution: "FA",
      sectionGroup: "critical",
    };
    const onDelete = vi.fn().mockResolvedValue(null);
    render(<CalendarEventEditorDialog date="2026-08-15" event={event} calendars={calendars} timeZone="America/New_York" onClose={vi.fn()} onSave={vi.fn()} onDelete={onDelete} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete from Google" }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete from Google" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(event));
  });
});

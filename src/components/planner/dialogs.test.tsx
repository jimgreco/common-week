import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarEventEditorDialog, EventDetailDialog, LocationDialog } from "@/components/planner/dialogs";
import type { CalendarEvent } from "@/types/domain";

const searchLocationsAction = vi.fn();

vi.mock("@/app/actions/planner", () => ({
  searchLocationsAction: (...args: unknown[]) => searchLocationsAction(...args),
}));

describe("LocationDialog", () => {
  const members = [{ id: "member-1", userId: "user-1", displayName: "Alex", email: "alex@example.com", role: "owner" as const }];
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
        members={members}
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
      ["member-1"],
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
        members={members}
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

    render(<EventDetailDialog event={event} timeZone="America/New_York" onClose={vi.fn()} onHide={onHide} onEdit={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Calendar event" })).toBeInTheDocument();
    expect(screen.getByText("Dinner reservation")).toBeInTheDocument();
    expect(screen.getByText("Saturday, August 15 · 7:00 PM–9:00 PM")).toBeInTheDocument();
    expect(screen.getByText("177 Main Street")).toBeInTheDocument();
    expect(screen.getByText("Time conflict")).toBeInTheDocument();
    expect(screen.getByText("This event overlaps another scheduled event.")).toBeInTheDocument();
    expect(screen.getByText("Patio table requested.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in Google" })).toHaveAttribute("href", event.googleUrl);

    fireEvent.click(screen.getByRole("button", { name: "Hide from Week of Us" }));
    await waitFor(() => expect(onHide).toHaveBeenCalledWith(event));
  });

  it("offers direct edit and confirmed delete controls for writable events", async () => {
    const event: CalendarEvent = {
      id: "family:event-2",
      providerEventId: "event-2",
      calendarPreferenceId: "00000000-0000-4000-8000-000000000001",
      etag: "etag-2",
      canEdit: true,
      title: "Soccer practice",
      start: "2026-08-16T10:00:00-04:00",
      end: "2026-08-16T11:00:00-04:00",
      allDay: false,
      calendarId: "family",
      calendarName: "Family",
      calendarAlias: "Family",
      calendarColor: "#688173",
      attribution: "FA",
      sectionGroup: "critical",
    };
    const onEdit = vi.fn();
    const onDelete = vi.fn().mockResolvedValue(null);

    render(<EventDetailDialog event={event} timeZone="America/New_York" onClose={vi.fn()} onHide={vi.fn()} onEdit={onEdit} onDelete={onDelete} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith(event);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete from Google" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(event, "occurrence"));
  });

  it("offers occurrence and series controls for a recurring event", () => {
    const event: CalendarEvent = {
      id: "family:occurrence-1",
      providerEventId: "occurrence-1",
      calendarPreferenceId: "00000000-0000-4000-8000-000000000001",
      etag: "etag-occurrence-1",
      recurringEventId: "series-1",
      canEdit: true,
      title: "Weekly lesson",
      start: "2026-08-16T10:00:00-04:00",
      end: "2026-08-16T11:00:00-04:00",
      allDay: false,
      calendarId: "family",
      calendarName: "Family",
      calendarAlias: "Family",
      calendarColor: "#688173",
      attribution: "FA",
      sectionGroup: "critical",
    };

    render(<EventDetailDialog event={event} timeZone="America/New_York" onClose={vi.fn()} onHide={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.getByText(/occurrence or the entire recurring series/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
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

  it("authors a recurring event and normalizes guest invitations", async () => {
    const onSave = vi.fn().mockResolvedValue(null);
    render(<CalendarEventEditorDialog date="2026-08-15" calendars={calendars} timeZone="America/New_York" onClose={vi.fn()} onSave={onSave} onDelete={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Biweekly dinner" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Repeats" }), { target: { value: "weekly" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Repeat interval" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Mon" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Repeat ends" }), { target: { value: "afterCount" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Recurrence count" }), { target: { value: "6" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Guests/ }), { target: { value: "Alex@example.com, sam@example.com, alex@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add event" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      recurrence: {
        frequency: "weekly",
        interval: 2,
        weekdays: ["MO", "SA"],
        ends: "afterCount",
        count: 6,
      },
      guestEmails: ["alex@example.com", "sam@example.com"],
    })));
  });

  it("moves an existing event to any calendar the actor can edit", async () => {
    const sourceId = "00000000-0000-4000-8000-000000000001";
    const destinationId = "00000000-0000-4000-8000-000000000003";
    const event: CalendarEvent = {
      id: "family:event-1",
      providerEventId: "event-1",
      sourceUserId: "user-a",
      calendarPreferenceId: sourceId,
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
    const onSave = vi.fn().mockResolvedValue(null);
    render(<CalendarEventEditorDialog
      date="2026-08-15"
      event={event}
      calendars={[
        { ...calendars[0], sourceUserId: "user-a" },
        { id: "00000000-0000-4000-8000-000000000002", sourceUserId: "user-a", name: "Personal", color: "#587f9b", sectionGroup: "supplemental" },
        { id: destinationId, sourceUserId: "user-b", name: "Partner", color: "#999999", sectionGroup: "supplemental" },
      ]}
      timeZone="America/New_York"
      onClose={vi.fn()}
      onSave={onSave}
      onDelete={vi.fn()}
    />);

    const calendar = screen.getByLabelText("Calendar");
    expect(calendar).toBeEnabled();
    expect(screen.getByRole("option", { name: "Partner" })).toBeInTheDocument();
    fireEvent.change(calendar, { target: { value: destinationId } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      sourceCalendarPreferenceId: sourceId,
      calendarPreferenceId: destinationId,
    })));
  });

  it("requires a series edit before moving a recurring event", () => {
    const sourceId = "00000000-0000-4000-8000-000000000001";
    const event: CalendarEvent = {
      id: "family:occurrence-1",
      providerEventId: "occurrence-1",
      sourceUserId: "user-a",
      calendarPreferenceId: sourceId,
      etag: "etag-1",
      recurringEventId: "series-1",
      canEdit: true,
      title: "Weekly lesson",
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
    render(<CalendarEventEditorDialog
      date="2026-08-15"
      event={event}
      calendars={[
        { ...calendars[0], sourceUserId: "user-a" },
        { id: "00000000-0000-4000-8000-000000000002", sourceUserId: "user-a", name: "Personal", color: "#587f9b", sectionGroup: "supplemental" },
      ]}
      timeZone="America/New_York"
      onClose={vi.fn()}
      onSave={vi.fn()}
      onDelete={vi.fn()}
    />);

    const calendar = screen.getByLabelText("Calendar");
    expect(calendar).toBeDisabled();
    expect(screen.getByText(/choose entire series to move/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Apply changes to"), { target: { value: "series" } });
    expect(calendar).toBeEnabled();
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
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(event, "occurrence"));
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "@/components/settings/settings-panel";

const refreshGoogleCalendarsAction = vi.fn();
const updateCalendarPreferenceAction = vi.fn();
const restoreCalendarEventAction = vi.fn();

vi.mock("@/app/actions/settings", () => ({
  addLocationAction: vi.fn(),
  inviteMemberAction: vi.fn(),
  refreshGoogleCalendarsAction: (...args: unknown[]) => refreshGoogleCalendarsAction(...args),
  removeLocationAction: vi.fn(),
  restoreCalendarEventAction: (...args: unknown[]) => restoreCalendarEventAction(...args),
  setDefaultLocationAction: vi.fn(),
  updateCalendarPreferenceAction: (...args: unknown[]) => updateCalendarPreferenceAction(...args),
  updateHouseholdAction: vi.fn(),
}));
vi.mock("@/app/actions/auth", () => ({ signInWithGoogle: vi.fn() }));
vi.mock("@/app/actions/planner", () => ({ searchLocationsAction: vi.fn() }));

describe("SettingsPanel calendar degradation", () => {
  beforeEach(() => {
    refreshGoogleCalendarsAction.mockReset();
    updateCalendarPreferenceAction.mockReset();
    restoreCalendarEventAction.mockReset();
  });

  it("keeps settings usable when connected Calendar discovery fails", async () => {
    refreshGoogleCalendarsAction.mockResolvedValue({
      ok: false,
      error: "Google Calendar API needs to be enabled by the app owner. Your planner is still available.",
    });

    render(<SettingsPanel
      household={{ id: "household", name: "Greco family", timezone: "America/New_York", temperatureUnit: "fahrenheit" }}
      members={[{ id: "member", userId: "user", displayName: "Jim", email: "jim@example.com", role: "owner" }]}
      invitations={[]}
      locations={[]}
      calendars={[]}
      calendarConnected
      calendarWriteEnabled={false}
      isDemo={false}
    />);

    expect(screen.getByDisplayValue("Greco family")).toBeInTheDocument();
    expect(await screen.findByText(/Calendar API needs to be enabled/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try Calendar again" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect Google Calendar" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Enable calendar editing" })).toHaveAttribute("href", "/auth/google?calendar_write=1");
  });

  it("shows that calendars are private until their owner shares them", async () => {
    updateCalendarPreferenceAction.mockResolvedValue({ ok: true });

    render(<SettingsPanel
      household={{ id: "household", name: "Greco family", timezone: "America/New_York", temperatureUnit: "fahrenheit" }}
      members={[{ id: "member", userId: "user", displayName: "Jim", email: "jim@example.com", role: "owner" }]}
      invitations={[]}
      locations={[]}
      calendars={[{
        id: "00000000-0000-4000-8000-000000000003",
        userId: "user",
        googleCalendarId: "personal@example.com",
        calendarName: "Personal",
        displayAlias: null,
        displayAbbreviation: null,
        color: "#345678",
        isSelected: false,
        isPrimary: true,
        sectionGroup: "critical",
        accessRole: "owner",
      }]}
      calendarConnected
      calendarWriteEnabled={false}
      isDemo={false}
    />);

    expect(screen.getByText("Private by default")).toBeInTheDocument();
    expect(screen.getByText("Private · Primary")).toBeInTheDocument();
    const sharingSwitch = screen.getByRole("switch", { name: "Share Personal with workspace" });
    expect(sharingSwitch).toHaveAttribute("aria-checked", "false");

    fireEvent.click(sharingSwitch);

    expect(screen.getByText("Shared with workspace · Primary")).toBeInTheDocument();
    await waitFor(() => expect(updateCalendarPreferenceAction).toHaveBeenCalledWith({
      id: "00000000-0000-4000-8000-000000000003",
      isSelected: true,
      displayAlias: null,
      displayAbbreviation: null,
      sectionGroup: "critical",
    }));
  });

  it("derives a calendar badge and saves a custom override", async () => {
    updateCalendarPreferenceAction.mockResolvedValue({ ok: true });

    render(<SettingsPanel
      household={{ id: "household", name: "Greco family", timezone: "America/New_York", temperatureUnit: "fahrenheit" }}
      members={[{ id: "member", userId: "user", displayName: "Jim", email: "jim@example.com", role: "owner" }]}
      invitations={[]}
      locations={[]}
      calendars={[{
        id: "00000000-0000-4000-8000-000000000001",
        userId: "user",
        googleCalendarId: "family@example.com",
        calendarName: "Family",
        displayAlias: null,
        displayAbbreviation: null,
        color: "#123456",
        isSelected: true,
        isPrimary: false,
        sectionGroup: "critical",
        accessRole: "owner",
      }]}
      calendarConnected
      calendarWriteEnabled
      isDemo={false}
    />);

    expect(screen.getByText("FA")).toBeInTheDocument();
    const abbreviation = screen.getByRole("textbox", { name: "Badge abbreviation for Family" });
    expect(abbreviation).toHaveAttribute("placeholder", "FA");
    fireEvent.change(abbreviation, { target: { value: "fm" } });
    expect(abbreviation).toHaveValue("FM");
    fireEvent.blur(abbreviation);

    await waitFor(() => expect(updateCalendarPreferenceAction).toHaveBeenCalledWith({
      id: "00000000-0000-4000-8000-000000000001",
      isSelected: true,
      displayAlias: null,
      displayAbbreviation: "FM",
      sectionGroup: "critical",
    }));

    fireEvent.change(screen.getByRole("combobox", { name: "Section group for Family" }), { target: { value: "supplemental" } });
    await waitFor(() => expect(updateCalendarPreferenceAction).toHaveBeenCalledWith({
      id: "00000000-0000-4000-8000-000000000001",
      isSelected: true,
      displayAlias: null,
      displayAbbreviation: "FM",
      sectionGroup: "supplemental",
    }));
  });

  it("restores an event hidden from the household planner", async () => {
    restoreCalendarEventAction.mockResolvedValue({ ok: true });
    render(<SettingsPanel
      household={{ id: "household", name: "Greco family", timezone: "America/New_York", temperatureUnit: "fahrenheit" }}
      members={[]}
      invitations={[]}
      locations={[]}
      calendars={[]}
      hiddenEvents={[{
        id: "00000000-0000-4000-8000-000000000002",
        eventId: "family:event-1",
        title: "Dinner reservation",
        calendarName: "Family",
        eventStart: "2026-08-15T19:00:00-04:00",
        hiddenAt: "2026-08-12T21:00:00Z",
      }]}
      calendarConnected={false}
      calendarWriteEnabled={false}
      isDemo={false}
    />);

    expect(screen.getByText("Dinner reservation")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(restoreCalendarEventAction).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000002"));
    expect(screen.queryByText("Dinner reservation")).not.toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "@/components/settings/settings-panel";

const refreshGoogleCalendarsAction = vi.fn();
const updateCalendarPreferenceAction = vi.fn();

vi.mock("@/app/actions/settings", () => ({
  addLocationAction: vi.fn(),
  inviteMemberAction: vi.fn(),
  refreshGoogleCalendarsAction: (...args: unknown[]) => refreshGoogleCalendarsAction(...args),
  removeLocationAction: vi.fn(),
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
      isDemo={false}
    />);

    expect(screen.getByDisplayValue("Greco family")).toBeInTheDocument();
    expect(await screen.findByText(/Calendar API needs to be enabled/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try Calendar again" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect Google Calendar" })).not.toBeInTheDocument();
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
        googleCalendarId: "family@example.com",
        calendarName: "Family",
        displayAlias: null,
        displayAbbreviation: null,
        color: "#123456",
        isSelected: true,
        isPrimary: false,
      }]}
      calendarConnected
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
    }));
  });
});

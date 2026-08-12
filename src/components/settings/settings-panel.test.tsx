import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "@/components/settings/settings-panel";

const refreshGoogleCalendarsAction = vi.fn();

vi.mock("@/app/actions/settings", () => ({
  addLocationAction: vi.fn(),
  inviteMemberAction: vi.fn(),
  refreshGoogleCalendarsAction: (...args: unknown[]) => refreshGoogleCalendarsAction(...args),
  removeLocationAction: vi.fn(),
  setDefaultLocationAction: vi.fn(),
  updateCalendarPreferenceAction: vi.fn(),
  updateHouseholdAction: vi.fn(),
}));
vi.mock("@/app/actions/auth", () => ({ signInWithGoogle: vi.fn() }));
vi.mock("@/app/actions/planner", () => ({ searchLocationsAction: vi.fn() }));

describe("SettingsPanel calendar degradation", () => {
  beforeEach(() => {
    refreshGoogleCalendarsAction.mockReset();
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
});

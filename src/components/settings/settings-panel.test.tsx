import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "@/components/settings/settings-panel";

const refreshGoogleCalendarsAction = vi.fn();
const updateCalendarPreferenceAction = vi.fn();
const restoreCalendarEventAction = vi.fn();

vi.mock("@/app/actions/settings", () => ({
  addLocationAction: vi.fn(),
  cancelInvitationAction: vi.fn(),
  deleteAccountAction: vi.fn(),
  inviteMemberAction: vi.fn(),
  leaveHouseholdAction: vi.fn(),
  refreshGoogleCalendarsAction: (...args: unknown[]) => refreshGoogleCalendarsAction(...args),
  removeLocationAction: vi.fn(),
  removeMemberAction: vi.fn(),
  resendInvitationAction: vi.fn(),
  restoreCalendarEventAction: (...args: unknown[]) => restoreCalendarEventAction(...args),
  setDefaultLocationAction: vi.fn(),
  updateCalendarPreferenceAction: (...args: unknown[]) => updateCalendarPreferenceAction(...args),
  updateHouseholdAction: vi.fn(),
  transferOwnershipAction: vi.fn(),
}));
vi.mock("@/app/actions/auth", () => ({ signInWithGoogle: vi.fn() }));
vi.mock("@/app/actions/planner", () => ({ searchLocationsAction: vi.fn() }));
vi.mock("@/app/actions/notifications", () => ({ updateNotificationPreferencesAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

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
      theme="light"
      toggleTheme={() => {}}
      household={{ id: "household", name: "Greco family", timezone: "America/New_York", temperatureUnit: "fahrenheit" }}
      members={[{ id: "member", userId: "user", displayName: "Jim", email: "jim@example.com", role: "owner" }]}
      invitations={[]}
      locations={[]}
      calendars={[]}
      calendarConnected
      calendarWriteEnabled={false}
      currentUserId="user"
      isDemo={false}
    />);

    expect(screen.getByDisplayValue("Greco family")).toBeInTheDocument();
    expect(await screen.findByText(/Calendar API needs to be enabled/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try Calendar again" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect Google Calendar" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Enable calendar editing" })).toHaveAttribute("href", "/auth/google?calendar_write=1");
  });

  it("shows the complete owner and self-service account lifecycle", () => {
    render(<SettingsPanel
      theme="light"
      toggleTheme={() => {}}
      household={{ id: "household", name: "Greco family", timezone: "America/New_York", temperatureUnit: "fahrenheit" }}
      members={[
        { id: "owner-member", userId: "owner", displayName: "Jim", email: "jim@example.com", role: "owner" },
        { id: "other-member", userId: "other", displayName: "Rachel", email: "rachel@example.com", role: "member" },
      ]}
      invitations={[{ id: "invite", email: "guest@example.com", status: "pending", expiresAt: "2026-09-01T00:00:00Z", sentAt: "2026-08-21T00:00:00Z" }]}
      locations={[]}
      calendars={[]}
      calendarConnected={false}
      calendarWriteEnabled={false}
      currentUserId="owner"
      isDemo={false}
    />);

    expect(screen.getByRole("button", { name: "Make owner" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Rachel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resend" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    expect(screen.getByLabelText("Type DELETE to confirm")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Permanently delete account" })).toBeDisabled();
  });

  it("offers hide, private, and share visibility states", async () => {
    updateCalendarPreferenceAction.mockResolvedValue({ ok: true });

    render(<SettingsPanel
      theme="light"
      toggleTheme={() => {}}
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
        visibility: "hide",
        isPrimary: true,
        sectionGroup: "critical",
        accessRole: "owner",
      }]}
      calendarConnected
      calendarWriteEnabled={false}
      currentUserId="user"
      isDemo={false}
    />);

    expect(screen.getByText("Hidden by default")).toBeInTheDocument();
    expect(screen.getByText("Hidden from Week of Us · Primary")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Private" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Share" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Private" }));

    expect(screen.getByText("Only you can see this · Primary")).toBeInTheDocument();
    await waitFor(() => expect(updateCalendarPreferenceAction).toHaveBeenCalledWith({
      id: "00000000-0000-4000-8000-000000000003",
      visibility: "private",
      displayAlias: null,
      displayAbbreviation: null,
      sectionGroup: "critical",
    }));

    const shareButton = screen.getByRole("button", { name: "Share" });
    await waitFor(() => expect(shareButton).toBeEnabled());
    fireEvent.click(shareButton);
    expect(screen.getByText("Shared with household · Primary")).toBeInTheDocument();
    await waitFor(() => expect(updateCalendarPreferenceAction).toHaveBeenLastCalledWith({
      id: "00000000-0000-4000-8000-000000000003",
      visibility: "share",
      displayAlias: null,
      displayAbbreviation: null,
      sectionGroup: "critical",
    }));
  });

  it("derives a calendar badge and saves a custom override", async () => {
    updateCalendarPreferenceAction.mockResolvedValue({ ok: true });

    render(<SettingsPanel
      theme="light"
      toggleTheme={() => {}}
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
        visibility: "share",
        isPrimary: false,
        sectionGroup: "critical",
        accessRole: "owner",
      }]}
      calendarConnected
      calendarWriteEnabled
      currentUserId="user"
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
      visibility: "share",
      displayAlias: null,
      displayAbbreviation: "FM",
      sectionGroup: "critical",
    }));

    fireEvent.change(screen.getByRole("combobox", { name: "Section group for Family" }), { target: { value: "supplemental" } });
    await waitFor(() => expect(updateCalendarPreferenceAction).toHaveBeenCalledWith({
      id: "00000000-0000-4000-8000-000000000001",
      visibility: "share",
      displayAlias: null,
      displayAbbreviation: "FM",
      sectionGroup: "supplemental",
    }));
  });

  it("restores an event hidden from the household planner", async () => {
    restoreCalendarEventAction.mockResolvedValue({ ok: true });
    render(<SettingsPanel
      theme="light"
      toggleTheme={() => {}}
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
      currentUserId="user"
      isDemo={false}
    />);

    expect(screen.getByText("Dinner reservation")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(restoreCalendarEventAction).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000002"));
    expect(screen.queryByText("Dinner reservation")).not.toBeInTheDocument();
  });
});

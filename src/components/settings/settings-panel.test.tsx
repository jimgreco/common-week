import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "@/components/settings/settings-panel";

const refreshGoogleCalendarsAction = vi.fn();
const updateCalendarPreferenceAction = vi.fn();
const restoreCalendarEventAction = vi.fn();
const setDefaultLocationAction = vi.fn();
const updateHouseholdAction = vi.fn();
const inviteMemberAction = vi.fn();
const searchLocationsAction = vi.fn();

vi.mock("@/app/actions/settings", () => ({
  addLocationAction: vi.fn(),
  cancelInvitationAction: vi.fn(),
  deleteAccountAction: vi.fn(),
  inviteMemberAction: (...args: unknown[]) => inviteMemberAction(...args),
  leaveHouseholdAction: vi.fn(),
  refreshGoogleCalendarsAction: (...args: unknown[]) => refreshGoogleCalendarsAction(...args),
  removeLocationAction: vi.fn(),
  removeMemberAction: vi.fn(),
  resendInvitationAction: vi.fn(),
  restoreCalendarEventAction: (...args: unknown[]) => restoreCalendarEventAction(...args),
  setDefaultLocationAction: (...args: unknown[]) => setDefaultLocationAction(...args),
  updateCalendarPreferenceAction: (...args: unknown[]) => updateCalendarPreferenceAction(...args),
  updateHouseholdAction: (...args: unknown[]) => updateHouseholdAction(...args),
  transferOwnershipAction: vi.fn(),
}));
vi.mock("@/app/actions/auth", () => ({ signInWithGoogle: vi.fn() }));
vi.mock("@/app/actions/planner", () => ({ searchLocationsAction: (...args: unknown[]) => searchLocationsAction(...args) }));
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

const recoveryProps = {
  household: { id: "household", name: "Our family", timezone: "America/New_York", temperatureUnit: "fahrenheit" as const },
  members: [{ id: "member", userId: "user", displayName: "Alex", email: "alex@example.com", role: "owner" as const }],
  invitations: [], locations: [{ id: "home", name: "Home", latitude: 40, longitude: -73, timezone: "America/New_York", isSaved: true, isDefault: true }, { id: "away", name: "Away", latitude: 41, longitude: -74, timezone: "America/New_York", isSaved: true }],
  calendars: [{ id: "calendar", userId: "user", googleCalendarId: "family", calendarName: "Family", displayAlias: null, displayAbbreviation: null, color: "#345678", visibility: "hide" as const, isPrimary: true, sectionGroup: "critical" as const, accessRole: "owner" as const }],
  calendarConnected: true, calendarWriteEnabled: true, currentUserId: "user", isDemo: false,
};
describe("settings write recovery", () => {
  it("keeps failed alias text and retries the latest input", async () => {
    updateCalendarPreferenceAction.mockReset().mockResolvedValueOnce({ ok: false, error: "Calendar save unavailable" }).mockResolvedValue({ ok: true });
    render(<SettingsPanel {...recoveryProps} />);
    const input = screen.getByLabelText("Alias for Family");
    fireEvent.change(input, { target: { value: "Kids" } }); fireEvent.blur(input);
    expect(await screen.findByRole("alert")).toHaveTextContent("Calendar save unavailable");
    expect(input).toHaveValue("Kids");
    fireEvent.change(input, { target: { value: "Children" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry save" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    await waitFor(() => expect(updateCalendarPreferenceAction).toHaveBeenLastCalledWith(expect.objectContaining({ displayAlias: "Children" })));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
  it("rolls back visibility after a rejected network request", async () => {
    updateCalendarPreferenceAction.mockReset().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue({ ok: true });
    render(<SettingsPanel {...recoveryProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection interrupted");
    expect(screen.getByRole("button", { name: "Hide" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry save" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Share" })).toHaveAttribute("aria-pressed", "true"));
  });
  it("retains the old default location until a retry succeeds", async () => {
    setDefaultLocationAction.mockReset().mockResolvedValueOnce({ ok: false, error: "Location save failed" }).mockResolvedValue({ ok: true });
    render(<SettingsPanel {...recoveryProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Make default" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Location save failed");
    expect(screen.getByText("Home").closest(".location-setting")).toHaveTextContent("Default");
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry save" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    await waitFor(() => expect(screen.getByText("Away").closest(".location-setting")).toHaveTextContent("Default"));
  });
  it("preserves preference edits after a server failure and retries", async () => {
    updateHouseholdAction.mockReset().mockResolvedValueOnce({ ok: false, error: "Preferences unavailable" }).mockResolvedValue({ ok: true });
    render(<SettingsPanel {...recoveryProps} />);
    fireEvent.change(screen.getByLabelText("Temperature"), { target: { value: "celsius" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Preferences unavailable");
    expect(screen.getByLabelText("Temperature")).toHaveValue("celsius");
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry save" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    await waitFor(() => expect(updateHouseholdAction).toHaveBeenLastCalledWith(expect.objectContaining({ temperatureUnit: "celsius" })));
  });
  it("keeps an invitation email visible after delivery failure", async () => {
    inviteMemberAction.mockReset().mockResolvedValueOnce({ ok: false, error: "Invitation delivery failed" }).mockResolvedValue({ ok: true });
    render(<SettingsPanel {...recoveryProps} />);
    const email = screen.getByLabelText("Partner email");
    fireEvent.change(email, { target: { value: "partner@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Invite member" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invitation delivery failed");
    expect(email).toHaveValue("partner@example.com");
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry save" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    await waitFor(() => expect(email).toHaveValue(""));
  });
  it("distinguishes location search failure from no results", async () => {
    searchLocationsAction.mockReset().mockResolvedValue({ ok: false, error: "Location search unavailable" });
    render(<SettingsPanel {...recoveryProps} />);
    fireEvent.change(screen.getByPlaceholderText("Search Paris, Palm Beach, Sag Harbor…"), { target: { value: "Paris" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Location search unavailable");
    expect(screen.getByPlaceholderText("Search Paris, Palm Beach, Sag Harbor…")).toHaveValue("Paris");
  });
});

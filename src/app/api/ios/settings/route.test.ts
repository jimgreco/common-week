import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUserCalendarPreferences: vi.fn(),
  inviteMemberAction: vi.fn(),
  removeMemberAction: vi.fn(),
  query: vi.fn(),
  refreshGoogleCalendarsAction: vi.fn(),
  requireIOSIdentity: vi.fn(),
  transferOwnershipAction: vi.fn(),
  updateCalendarPreferenceAction: vi.fn(),
  updateHouseholdAction: vi.fn(),
}));

vi.mock("@/app/actions/settings", () => ({
  inviteMemberAction: (...args: unknown[]) => mocks.inviteMemberAction(...args),
  removeMemberAction: (...args: unknown[]) => mocks.removeMemberAction(...args),
  refreshGoogleCalendarsAction: (...args: unknown[]) => mocks.refreshGoogleCalendarsAction(...args),
  transferOwnershipAction: (...args: unknown[]) => mocks.transferOwnershipAction(...args),
  updateCalendarPreferenceAction: (...args: unknown[]) => mocks.updateCalendarPreferenceAction(...args),
  updateHouseholdAction: (...args: unknown[]) => mocks.updateHouseholdAction(...args),
}));
vi.mock("@/lib/server/calendar-data", () => ({
  getCurrentUserCalendarPreferences: (...args: unknown[]) => mocks.getCurrentUserCalendarPreferences(...args),
}));
vi.mock("@/lib/server/database", () => ({ query: (...args: unknown[]) => mocks.query(...args) }));
vi.mock("@/lib/server/google-oauth", () => ({
  GOOGLE_CALENDAR_WRITE_SCOPE: "calendar.events",
  hasGoogleScope: (scope: string | null | undefined) => scope?.includes("calendar.events") === true,
}));
vi.mock("@/lib/server/ios-api", () => ({
  actionResponse: (result: { ok: boolean; error?: string; data?: unknown }) => Response.json(result, { status: result.ok ? 200 : 400 }),
  requireIOSIdentity: (...args: unknown[]) => mocks.requireIOSIdentity(...args),
  unauthorizedResponse: () => Response.json({ ok: false, error: "Authentication required." }, { status: 401 }),
}));

import { GET, PATCH } from "@/app/api/ios/settings/route";

const calendar = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "user-a",
  googleCalendarId: "family@example.com",
  calendarName: "Family",
  displayAlias: null,
  displayAbbreviation: "FA",
  color: "#123456",
  visibility: "share",
  isPrimary: true,
  sectionGroup: "critical",
  accessRole: "owner",
};

describe("iOS calendar settings API", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.requireIOSIdentity.mockResolvedValue({
      identity: { userId: "user-a", householdId: "household-a" },
      token: "session-token",
    });
  });

  it("returns the signed-in member's calendars and authorization state", async () => {
    mocks.getCurrentUserCalendarPreferences.mockResolvedValue([calendar]);
    mocks.query.mockResolvedValue({ rows: [{ scope: "openid calendar.events" }], rowCount: 1 });

    const response = await GET(new Request("https://weekofus.com/api/ios/settings") as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { calendars: [calendar], connected: true, writeEnabled: true },
    });
    expect(mocks.getCurrentUserCalendarPreferences).toHaveBeenCalledWith("user-a");
  });

  it("updates calendar sharing and presentation settings", async () => {
    mocks.updateCalendarPreferenceAction.mockResolvedValue({ ok: true });
    const input = {
      action: "updateCalendar",
      id: calendar.id,
      visibility: "private",
      displayAlias: "Home",
      displayAbbreviation: "HM",
      sectionGroup: "supplemental",
    };

    const response = await PATCH(new Request("https://weekofus.com/api/ios/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }) as never);

    expect(response.status).toBe(200);
    expect(mocks.updateCalendarPreferenceAction).toHaveBeenCalledWith({
      id: calendar.id,
      visibility: "private",
      displayAlias: "Home",
      displayAbbreviation: "HM",
      sectionGroup: "supplemental",
    });
  });

  it("refreshes Google calendar discovery from the native app", async () => {
    mocks.refreshGoogleCalendarsAction.mockResolvedValue({ ok: true, data: { calendars: [calendar], connected: true } });

    const response = await PATCH(new Request("https://weekofus.com/api/ios/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "refreshCalendars" }),
    }) as never);

    expect(response.status).toBe(200);
    expect(mocks.refreshGoogleCalendarsAction).toHaveBeenCalledOnce();
  });

  it("transfers household ownership from the native app", async () => {
    mocks.transferOwnershipAction.mockResolvedValue({ ok: true });
    const memberId = "00000000-0000-4000-8000-000000000002";

    const response = await PATCH(new Request("https://weekofus.com/api/ios/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "transferOwnership", id: memberId }),
    }) as never);

    expect(response.status).toBe(200);
    expect(mocks.transferOwnershipAction).toHaveBeenCalledWith(memberId);
  });

  it("removes a household member from the native app", async () => {
    mocks.removeMemberAction.mockResolvedValue({ ok: true });
    const memberId = "00000000-0000-4000-8000-000000000002";

    const response = await PATCH(new Request("https://weekofus.com/api/ios/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "removeMember", id: memberId }),
    }) as never);

    expect(response.status).toBe(200);
    expect(mocks.removeMemberAction).toHaveBeenCalledWith(memberId);
  });
});

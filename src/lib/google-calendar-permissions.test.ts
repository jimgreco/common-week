import { describe, expect, it } from "vitest";
import { canHouseholdMemberWriteGoogleCalendar } from "@/lib/google-calendar-permissions";

const base = {
  actorRole: "member" as const,
  actorUserId: "member-b",
  calendarOwnerUserId: "member-a",
  visibility: "share" as const,
  accessRole: "owner" as const,
  calendarWriteEnabled: true,
};

describe("household Google Calendar write permissions", () => {
  it("lets a household member change events on a shared writable calendar", () => {
    expect(canHouseholdMemberWriteGoogleCalendar(base)).toBe(true);
  });

  it("keeps another member's private and hidden calendars read-only", () => {
    expect(canHouseholdMemberWriteGoogleCalendar({ ...base, visibility: "private" })).toBe(false);
    expect(canHouseholdMemberWriteGoogleCalendar({ ...base, visibility: "hide" })).toBe(false);
  });

  it("keeps viewer roles, read-only calendars, and calendars without write authorization read-only", () => {
    expect(canHouseholdMemberWriteGoogleCalendar({ ...base, actorRole: "viewer" })).toBe(false);
    expect(canHouseholdMemberWriteGoogleCalendar({ ...base, accessRole: "reader" })).toBe(false);
    expect(canHouseholdMemberWriteGoogleCalendar({ ...base, calendarWriteEnabled: false })).toBe(false);
  });

  it("lets a member write to their own visible writable calendars", () => {
    expect(canHouseholdMemberWriteGoogleCalendar({
      ...base,
      actorUserId: "member-a",
      visibility: "private",
    })).toBe(true);
  });
});

import type { CalendarVisibility, GoogleCalendarAccessRole, HouseholdMember } from "@/types/domain";

export const WRITABLE_GOOGLE_CALENDAR_ROLES = new Set<GoogleCalendarAccessRole>([
  "writer",
  "owner",
]);

export function isWritableGoogleCalendarRole(role: GoogleCalendarAccessRole): boolean {
  return WRITABLE_GOOGLE_CALENDAR_ROLES.has(role);
}

export function canHouseholdMemberWriteGoogleCalendar(input: {
  actorRole: HouseholdMember["role"];
  actorUserId: string;
  calendarOwnerUserId: string;
  visibility: CalendarVisibility;
  accessRole: GoogleCalendarAccessRole;
  calendarWriteEnabled: boolean;
}): boolean {
  if (input.actorRole === "viewer" || !input.calendarWriteEnabled) return false;
  if (!isWritableGoogleCalendarRole(input.accessRole)) return false;
  if (input.calendarOwnerUserId === input.actorUserId) return input.visibility !== "hide";
  return input.visibility === "share";
}

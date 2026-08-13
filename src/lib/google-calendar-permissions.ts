import type { GoogleCalendarAccessRole } from "@/types/domain";

export const WRITABLE_GOOGLE_CALENDAR_ROLES = new Set<GoogleCalendarAccessRole>([
  "writer",
  "owner",
]);

export function isWritableGoogleCalendarRole(role: GoogleCalendarAccessRole): boolean {
  return WRITABLE_GOOGLE_CALENDAR_ROLES.has(role);
}

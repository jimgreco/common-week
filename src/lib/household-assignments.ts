import { z } from "zod";
export const assignedMembersSchema = z.array(z.string().uuid()).max(100).transform((ids) => [...new Set(ids)]);
import type { CalendarEvent, FamilyPlanningData, PlanningItem } from "@/types/domain";
export function itemMemberIds(item: PlanningItem): string[] { return item.assignedMemberIds ?? (item.childId ? [item.childId] : []); }
export function familyEvent(event: CalendarEvent, family: FamilyPlanningData): CalendarEvent {
  const calendar = event.calendarPreferenceId ?? event.calendarId;
  const defaults = family.adults.length ? [...family.adults.filter((adult) => adult.calendarPreferenceIds.includes(calendar)).map((adult) => adult.userId), ...family.children.filter((child) => child.calendarPreferenceIds.includes(calendar)).map((child) => child.id)] : event.defaultMemberIds ?? event.assignedMemberIds ?? event.assignedAdultUserIds ?? (event.sourceUserId ? [event.sourceUserId] : []);
  return { ...event, defaultMemberIds: defaults, assignedMemberIds: event.memberOverrideIds ?? defaults };
}

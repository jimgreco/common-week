import { z } from "zod";
import type { CalendarEvent, ChildProfile } from "@/types/domain";
export interface EventCoverage {
  calendarId: string;
  eventId: string;
  childId: string;
  dropOffUserId: string | null;
  pickupUserId: string | null;
  dropOffNeeded: boolean;
  pickupNeeded: boolean;
  dropOffConfirmed: boolean;
  pickupConfirmed: boolean;
  travelMinutes: number;
  notes: string;
  revision: number;
}
export const coverageSchema = z.object({
  calendarId: z.string().uuid(),
  eventId: z.string().min(1).max(1024),
  childId: z.string().uuid(),
  dropOffUserId: z.string().uuid().nullable(),
  pickupUserId: z.string().uuid().nullable(),
  dropOffNeeded: z.boolean(),
  pickupNeeded: z.boolean(),
  travelMinutes: z.number().int().min(0).max(180),
  notes: z.string().trim().max(1000),
  revision: z.number().int().min(0),
  confirmation: z.enum(["dropOff", "pickup"]).optional(),
  confirmed: z.boolean().optional(),
});
export function defaultCoverage(
  calendarId: string,
  eventId: string,
  childId: string,
): EventCoverage {
  return {
    calendarId,
    eventId,
    childId,
    dropOffUserId: null,
    pickupUserId: null,
    dropOffNeeded: true,
    pickupNeeded: true,
    dropOffConfirmed: false,
    pickupConfirmed: false,
    travelMinutes: 20,
    notes: "",
    revision: 0,
  };
}
export function childrenForEvent(
  event: CalendarEvent,
  children: ChildProfile[],
): ChildProfile[] {
  return children.filter((child) =>
    event.assignedMemberIds
      ? event.assignedMemberIds.includes(child.id)
      : child.calendarPreferenceIds.includes(event.calendarPreferenceId ?? ""),
  );
}
export function coverageStatus(entry: EventCoverage): string {
  const needed = [
    entry.dropOffNeeded &&
      (!entry.dropOffUserId
        ? "Drop-off needs an owner"
        : !entry.dropOffConfirmed
          ? "Drop-off awaiting confirmation"
          : ""),
    entry.pickupNeeded &&
      (!entry.pickupUserId
        ? "Pickup needs an owner"
        : !entry.pickupConfirmed
          ? "Pickup awaiting confirmation"
          : ""),
  ].filter(Boolean);
  return needed.join(" · ") || "Coverage confirmed";
}
export function coverageWarnings(
  events: CalendarEvent[],
  entries: EventCoverage[],
): string[] {
  const slots: {
    user: string;
    time: number;
    buffer: number;
    title: string;
    key: string;
  }[] = [];
  for (const entry of entries) {
    const e = events.find(
      (e) =>
        e.calendarPreferenceId === entry.calendarId &&
        e.providerEventId === entry.eventId,
    );
    if (!e || e.allDay) continue;
    if (entry.dropOffNeeded && entry.dropOffUserId)
      slots.push({
        user: entry.dropOffUserId,
        time: Date.parse(e.start),
        buffer: entry.travelMinutes,
        title: `Drop-off: ${e.title}`,
        key: `${e.id}:drop`,
      });
    if (entry.pickupNeeded && entry.pickupUserId)
      slots.push({
        user: entry.pickupUserId,
        time: Date.parse(e.end),
        buffer: entry.travelMinutes,
        title: `Pickup: ${e.title}`,
        key: `${e.id}:pick`,
      });
  }
  const unique = [
    ...new Map(slots.map((s) => [`${s.user}:${s.key}`, s])).values(),
  ].sort((a, b) => a.time - b.time);
  const warnings = new Set<string>();
  for (let i = 0; i < unique.length; i++) {
    const a = unique[i];
    const b = unique.slice(i + 1).find((b) => b.user === a.user);
    if (b && (b.time - a.time) / 60000 < Math.max(a.buffer, b.buffer))
      warnings.add(
        `${a.title} → ${b.title}: less than ${Math.max(a.buffer, b.buffer)} minutes for travel.`,
      );
    for (const e of events) {
      if (
        e.allDay ||
        a.key.startsWith(`${e.id}:`) ||
        !e.assignedMemberIds?.includes(a.user)
      )
        continue;
      const start = Date.parse(e.start),
        end = Date.parse(e.end);
      if (a.time >= start && a.time < end)
        warnings.add(`${a.title} overlaps ${e.title} for the assigned adult.`);
    }
  }
  return [...warnings];
}

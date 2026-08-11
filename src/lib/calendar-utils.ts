import { addDateDays } from "@/lib/date";
import type { CalendarEvent } from "@/types/domain";

export function markCalendarConflicts(events: CalendarEvent[]): CalendarEvent[] {
  const timed = events.filter((event) => !event.allDay);
  const conflictingIds = new Set<string>();

  for (let leftIndex = 0; leftIndex < timed.length; leftIndex += 1) {
    const left = timed[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < timed.length; rightIndex += 1) {
      const right = timed[rightIndex];
      if (new Date(left.start) < new Date(right.end) && new Date(right.start) < new Date(left.end)) {
        conflictingIds.add(left.id);
        conflictingIds.add(right.id);
      }
    }
  }

  return events.map((event) => ({ ...event, isConflict: conflictingIds.has(event.id) }));
}

export function eventFallsOnDate(event: CalendarEvent, date: string, timeZone: string): boolean {
  if (event.allDay) {
    const startDate = event.start.slice(0, 10);
    const exclusiveEnd = event.end.slice(0, 10);
    return date >= startDate && date < exclusiveEnd;
  }

  const dayStart = new Date(`${date}T00:00:00`);
  const nextDayStart = new Date(`${addDateDays(date, 1)}T00:00:00`);
  const formatInZone = (value: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(value);

  const toComparable = (value: Date) => {
    const parts = Object.fromEntries(formatInZone(value).map((part) => [part.type, part.value]));
    return new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00`);
  };

  const start = toComparable(new Date(event.start));
  const end = toComparable(new Date(event.end));
  return start < nextDayStart && end > dayStart;
}

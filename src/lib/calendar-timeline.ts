import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { addDateDays } from "@/lib/date";
import type { CalendarEvent } from "@/types/domain";

export interface TimelineEvent {
  event: CalendarEvent;
  startMinute: number;
  endMinute: number;
  column: number;
  columnCount: number;
  overlaps: boolean;
}

export function minuteInTimeZone(date: Date, timeZone: string): number {
  return Number(formatInTimeZone(date, timeZone, "H")) * 60 + Number(formatInTimeZone(date, timeZone, "m"));
}

// Local clock positions keep the same hours aligned across every day of the week.
export function layoutTimelineEvents(events: CalendarEvent[], date: string, timeZone: string): TimelineEvent[] {
  const dayStart = fromZonedTime(`${date}T00:00:00`, timeZone).getTime();
  const dayEnd = fromZonedTime(`${addDateDays(date, 1)}T00:00:00`, timeZone).getTime();
  const seen = new Set<string>();
  const blocks: TimelineEvent[] = [];
  for (const event of events) {
    const start = Date.parse(event.start);
    const end = Date.parse(event.end);
    if (event.allDay || seen.has(event.id) || !Number.isFinite(start) || !Number.isFinite(end)
      || end <= start || start >= dayEnd || end <= dayStart) continue;
    seen.add(event.id);
    const startMinute = start <= dayStart ? 0 : minuteInTimeZone(new Date(start), timeZone);
    const clockEnd = end >= dayEnd ? 1440 : minuteInTimeZone(new Date(end), timeZone);
    // A fall-back transition can end earlier on the clock. Preserve a visible block;
    // the event label includes its exact times and offsets on transition days.
    const endMinute = clockEnd > startMinute ? clockEnd : Math.min(1440, startMinute + (Math.min(end, dayEnd) - Math.max(start, dayStart)) / 60_000);
    blocks.push({ event, startMinute, endMinute, column: 0, columnCount: 1, overlaps: false });
  }
  blocks.sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute || a.event.id.localeCompare(b.event.id));
  let group: TimelineEvent[] = [];
  let columnEnds: number[] = [];
  const finishGroup = () => {
    for (const block of group) block.columnCount = columnEnds.length;
    group = [];
    columnEnds = [];
  };
  for (const block of blocks) {
    if (group.length && columnEnds.every((end) => end <= block.startMinute)) finishGroup();
    const free = columnEnds.findIndex((end) => end <= block.startMinute);
    block.column = free < 0 ? columnEnds.length : free;
    // Reserve room for short-event labels without covering an adjacent event.
    columnEnds[block.column] = Math.max(block.endMinute, block.startMinute + 15);
    group.push(block);
    block.overlaps = blocks.some((other) => other !== block
      && Date.parse(block.event.start) < Date.parse(other.event.end)
      && Date.parse(other.event.start) < Date.parse(block.event.end));
  }
  finishGroup();
  return blocks;
}

export function timelineEventLabel(event: CalendarEvent, date: string, timeZone: string): string {
  if (event.allDay) return "All day";
  const start = new Date(event.start);
  const end = new Date(event.end);
  const crossesDate = formatInTimeZone(start, timeZone, "yyyy-MM-dd") !== date
    || formatInTimeZone(end, timeZone, "yyyy-MM-dd") !== date;
  const changesOffset = formatInTimeZone(start, timeZone, "xxx") !== formatInTimeZone(end, timeZone, "xxx");
  const pattern = `${crossesDate ? "MMM d, " : ""}h:mm a${changesOffset ? " zzz" : ""}`;
  return `${formatInTimeZone(start, timeZone, pattern)} – ${formatInTimeZone(end, timeZone, pattern)}`;
}

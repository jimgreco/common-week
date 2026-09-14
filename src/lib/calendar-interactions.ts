import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { addDateDays } from "@/lib/date";
import type { CalendarEvent, CalendarEventDraft, DayPlan, EditableCalendar } from "@/types/domain";

export interface CalendarSlot { date: string; minute: number | null }
export function calendarSlot(date: string, minute: number): CalendarSlot {
  const rounded = Math.round(minute / 15) * 15;
  return { date: addDateDays(date, Math.floor(rounded / 1440)), minute: ((rounded % 1440) + 1440) % 1440 };
}
export function calendarDayDifference(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}
export function slotInstant(slot: CalendarSlot, timeZone: string): Date {
  const minute = slot.minute ?? 540;
  const clock = `${slot.date}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  const instant = fromZonedTime(clock, timeZone);
  if (!Number.isFinite(instant.getTime()) || formatInTimeZone(instant, timeZone, "yyyy-MM-dd'T'HH:mm") !== clock) {
    throw new Error("That time does not exist because the clocks change. Choose another time.");
  }
  return instant;
}
function fields(start: Date, end: Date, timeZone: string) {
  return { startDate: formatInTimeZone(start, timeZone, "yyyy-MM-dd"), endDate: formatInTimeZone(end, timeZone, "yyyy-MM-dd"), startTime: formatInTimeZone(start, timeZone, "HH:mm"), endTime: formatInTimeZone(end, timeZone, "HH:mm") };
}
export function newCalendarDraft(slot: CalendarSlot, calendarPreferenceId: string, timeZone: string): CalendarEventDraft {
  const start = slotInstant(slot, timeZone);
  return { requestId: crypto.randomUUID(), calendarPreferenceId, title: "", description: "", location: "", allDay: slot.minute === null,
    ...fields(start, slot.minute === null ? start : new Date(start.getTime() + 3600000), timeZone) };
}
export function calendarMoveDraft(event: CalendarEvent, slot: CalendarSlot, timeZone: string): CalendarEventDraft {
  if (!event.canEdit || !event.calendarPreferenceId || !event.providerEventId || !event.etag) throw new Error("This event cannot be moved. Refresh the calendar or open its details.");
  if (event.allDay !== (slot.minute === null)) throw new Error("Move all-day events within the all-day row, and timed events within the hours.");
  let times;
  if (event.allDay) {
    const days = calendarDayDifference(event.start.slice(0, 10), event.end.slice(0, 10));
    if (days < 1) throw new Error("Refresh this event before moving it.");
    times = { startDate: slot.date, endDate: addDateDays(slot.date, days - 1), startTime: "09:00", endTime: "10:00" };
  } else {
    const duration = Date.parse(event.end) - Date.parse(event.start);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("Refresh this event before moving it.");
    const start = slotInstant(slot, timeZone);
    const end = new Date(start.getTime() + duration);
    times = fields(start, end, timeZone);
    if (fromZonedTime(`${times.endDate}T${times.endTime}:00`, timeZone).getTime() !== end.getTime()) throw new Error("This event’s exact duration cannot be preserved at that time. Open the event to choose its times.");
  }
  return { requestId: crypto.randomUUID(), calendarPreferenceId: event.calendarPreferenceId, sourceCalendarPreferenceId: event.calendarPreferenceId,
    providerEventId: event.providerEventId, etag: event.etag, recurringEventId: event.recurringEventId, recurringScope: event.recurringEventId ? "occurrence" : undefined,
    title: event.title, description: event.description ?? "", location: event.location ?? "", allDay: event.allDay, ...times };
}

// Demo mutations use the same exclusive all-day end and visible-day placement as provider events.
export function applyDemoCalendarDraft(days: DayPlan[], draft: CalendarEventDraft, calendars: EditableCalendar[], timeZone: string): DayPlan[] {
  const prior = days.flatMap(day => day.events).find(event => event.providerEventId === draft.providerEventId && event.calendarPreferenceId === (draft.sourceCalendarPreferenceId ?? draft.calendarPreferenceId));
  const calendar = calendars.find(calendar => calendar.id === draft.calendarPreferenceId);
  if (!calendar) throw new Error("Choose an editable calendar.");
  const start = draft.allDay ? draft.startDate : fromZonedTime(`${draft.startDate}T${draft.startTime}:00`, timeZone).toISOString();
  const end = draft.allDay ? addDateDays(draft.endDate, 1) : fromZonedTime(`${draft.endDate}T${draft.endTime}:00`, timeZone).toISOString();
  if (end <= start) throw new Error("End time must be after the start time.");
  const event: CalendarEvent = { ...prior, id: prior?.id ?? crypto.randomUUID(), providerEventId: prior?.providerEventId ?? crypto.randomUUID(), etag: crypto.randomUUID(),
    calendarPreferenceId: calendar.id, canEdit: true, title: draft.title, description: draft.description, location: draft.location, start, end, allDay: draft.allDay,
    calendarId: prior?.calendarId ?? calendar.id, calendarName: calendar.name, calendarAlias: calendar.name, calendarColor: calendar.color,
    attribution: prior?.attribution ?? "Family", sectionGroup: calendar.sectionGroup };
  return days.map(day => {
    const visible = draft.allDay ? day.date >= start && day.date < end
      : Date.parse(start) < fromZonedTime(`${addDateDays(day.date, 1)}T00:00:00`, timeZone).getTime() && Date.parse(end) > fromZonedTime(`${day.date}T00:00:00`, timeZone).getTime();
    return { ...day, events: [...day.events.filter(item => item.id !== event.id), ...(visible ? [event] : [])] };
  });
}

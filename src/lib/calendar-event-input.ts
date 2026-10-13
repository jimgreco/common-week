import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { addDateDays, isDateOnly } from "@/lib/date";
import type { GoogleCalendarEventInput, GoogleCalendarEventResource } from "@/lib/integrations/google-calendar";
import type { CalendarEventDraft, CalendarRecurrenceRule } from "@/types/domain";

export function calendarLocalInstant(date: string, time: string, timeZone: string): Date {
  if (!isDateOnly(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error("Choose a valid date and time.");
  }
  const clock = `${date}T${time}`;
  const instant = fromZonedTime(clock, timeZone);
  if (!Number.isFinite(instant.getTime()) || formatInTimeZone(instant, timeZone, "yyyy-MM-dd'T'HH:mm") !== clock) {
    throw new Error("That time does not exist because the clocks change. Choose another time.");
  }
  return instant;
}

export function buildGoogleRecurrenceRule(rule: CalendarRecurrenceRule, timeZone: string, allDay = false): string {
  const parts = [`FREQ=${rule.frequency.toUpperCase()}`, `INTERVAL=${rule.interval}`];
  if (rule.frequency === "weekly" && rule.weekdays?.length) {
    parts.push(`BYDAY=${rule.weekdays.join(",")}`);
  }
  if (rule.ends === "onDate" && rule.untilDate) {
    if (allDay) {
      parts.push(`UNTIL=${rule.untilDate.replaceAll("-", "")}`);
    } else {
      const endOfDay = fromZonedTime(`${rule.untilDate}T23:59:59`, timeZone);
      parts.push(`UNTIL=${formatInTimeZone(endOfDay, "UTC", "yyyyMMdd'T'HHmmss'Z'")}`);
    }
  } else if (rule.ends === "afterCount" && rule.count) {
    parts.push(`COUNT=${rule.count}`);
  }
  return `RRULE:${parts.join(";")}`;
}

export function buildGoogleCalendarEventInput(
  draft: CalendarEventDraft,
  timeZone: string,
  providerId?: string,
): GoogleCalendarEventInput {
  const common = {
    ...(providerId ? { id: providerId } : {}),
    summary: draft.title.trim(),
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    ...(draft.location.trim() ? { location: draft.location.trim() } : {}),
    ...(draft.recurrence ? { recurrence: [buildGoogleRecurrenceRule(draft.recurrence, timeZone, draft.allDay)] } : {}),
    ...(draft.guestEmails?.length
      ? { attendees: draft.guestEmails.map((email) => ({ email: email.trim().toLowerCase() })) }
      : {}),
  };

  if (draft.allDay) {
    return {
      ...common,
      start: { date: draft.startDate },
      end: { date: addDateDays(draft.endDate, 1) },
    };
  }

  const start = calendarLocalInstant(draft.startDate, draft.startTime, timeZone);
  const end = calendarLocalInstant(draft.endDate, draft.endTime, timeZone);
  if (end <= start) {
    throw new Error("End time must be after the start time.");
  }
  return {
    ...common,
    start: { dateTime: start.toISOString(), timeZone },
    end: { dateTime: end.toISOString(), timeZone },
  };
}

export function buildGoogleCalendarSeriesInput(
  draft: CalendarEventDraft,
  master: GoogleCalendarEventResource,
  timeZone: string,
): GoogleCalendarEventInput {
  if (draft.allDay) {
    if (!master.start.date || !master.end.date) throw new Error("Refresh the recurring event before changing the series.");
    return buildGoogleCalendarEventInput({
      ...draft,
      startDate: master.start.date,
      endDate: addDateDays(master.end.date, -1),
    }, timeZone);
  }
  if (!master.start.dateTime || !master.end.dateTime) throw new Error("Refresh the recurring event before changing the series.");
  return buildGoogleCalendarEventInput({
    ...draft,
    startDate: formatInTimeZone(new Date(master.start.dateTime), timeZone, "yyyy-MM-dd"),
    endDate: formatInTimeZone(new Date(master.end.dateTime), timeZone, "yyyy-MM-dd"),
  }, timeZone);
}

export function deterministicGoogleEventId(requestId: string): string {
  return `ce${requestId.replaceAll("-", "").toLowerCase()}`;
}

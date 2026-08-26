import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { addDateDays } from "@/lib/date";
import type { GoogleCalendarEventInput, GoogleCalendarEventResource } from "@/lib/integrations/google-calendar";
import type { CalendarEventDraft } from "@/types/domain";

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
  };

  if (draft.allDay) {
    return {
      ...common,
      start: { date: draft.startDate },
      end: { date: addDateDays(draft.endDate, 1) },
    };
  }

  const start = fromZonedTime(`${draft.startDate}T${draft.startTime}:00`, timeZone);
  const end = fromZonedTime(`${draft.endDate}T${draft.endTime}:00`, timeZone);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
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

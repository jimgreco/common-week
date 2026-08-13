import { fromZonedTime } from "date-fns-tz";
import { addDateDays } from "@/lib/date";
import type { GoogleCalendarEventInput } from "@/lib/integrations/google-calendar";
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

export function deterministicGoogleEventId(requestId: string): string {
  return `ce${requestId.replaceAll("-", "").toLowerCase()}`;
}

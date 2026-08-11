import "server-only";

import type { CalendarEvent, CalendarPreference } from "@/types/domain";

const GOOGLE_API = "https://www.googleapis.com/calendar/v3";

export interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  primary: boolean;
  backgroundColor: string;
  accessRole: string;
}

export interface GoogleCalendarService {
  listCalendars(accessToken: string): Promise<GoogleCalendarListEntry[]>;
  listEvents(
    accessToken: string,
    preference: CalendarPreference,
    timeMin: string,
    timeMax: string,
    timeZone: string,
    attribution: string,
  ): Promise<CalendarEvent[]>;
}

interface GoogleCalendarListResponse {
  items?: Array<{
    id: string;
    summary?: string;
    primary?: boolean;
    backgroundColor?: string;
    accessRole?: string;
  }>;
  nextPageToken?: string;
}

interface GoogleEventsResponse {
  items?: Array<{
    id: string;
    summary?: string;
    status?: string;
    start?: { date?: string; dateTime?: string };
    end?: { date?: string; dateTime?: string };
  }>;
  nextPageToken?: string;
}

async function googleFetch<T>(url: URL, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });

  if (response.status === 401) {
    throw new Error("GOOGLE_AUTH_REQUIRED");
  }
  if (!response.ok) throw new Error(`Google Calendar returned ${response.status}.`);
  return (await response.json()) as T;
}

export class GoogleCalendarApiService implements GoogleCalendarService {
  async listCalendars(accessToken: string): Promise<GoogleCalendarListEntry[]> {
    const calendars: GoogleCalendarListEntry[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`${GOOGLE_API}/users/me/calendarList`);
      url.searchParams.set("minAccessRole", "reader");
      url.searchParams.set("showHidden", "false");
      url.searchParams.set("maxResults", "250");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const payload = await googleFetch<GoogleCalendarListResponse>(url, accessToken);
      calendars.push(...(payload.items ?? []).map((item) => ({
        id: item.id,
        summary: item.summary ?? "Calendar",
        primary: Boolean(item.primary),
        backgroundColor: item.backgroundColor ?? "#718096",
        accessRole: item.accessRole ?? "reader",
      })));
      pageToken = payload.nextPageToken;
    } while (pageToken);
    return calendars;
  }

  async listEvents(
    accessToken: string,
    preference: CalendarPreference,
    timeMin: string,
    timeMax: string,
    timeZone: string,
    attribution: string,
  ): Promise<CalendarEvent[]> {
    const events: CalendarEvent[] = [];
    let pageToken: string | undefined;

    do {
      const calendarId = encodeURIComponent(preference.googleCalendarId);
      const url = new URL(`${GOOGLE_API}/calendars/${calendarId}/events`);
      url.searchParams.set("timeMin", timeMin);
      url.searchParams.set("timeMax", timeMax);
      url.searchParams.set("timeZone", timeZone);
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      url.searchParams.set("showDeleted", "false");
      url.searchParams.set("maxResults", "250");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const payload = await googleFetch<GoogleEventsResponse>(url, accessToken);
      for (const item of payload.items ?? []) {
        if (!item.id || item.status === "cancelled" || !item.start || !item.end) continue;
        const allDay = Boolean(item.start.date);
        const start = item.start.dateTime ?? item.start.date;
        const end = item.end.dateTime ?? item.end.date;
        if (!start || !end) continue;
        events.push({
          id: `${preference.googleCalendarId}:${item.id}`,
          title: item.summary?.trim() || "Busy",
          start,
          end,
          allDay,
          calendarId: preference.googleCalendarId,
          calendarName: preference.calendarName,
          calendarAlias: preference.displayAlias ?? preference.calendarName,
          calendarColor: preference.color,
          attribution,
        });
      }
      pageToken = payload.nextPageToken;
    } while (pageToken);

    return events;
  }
}

export const googleCalendarService: GoogleCalendarService = new GoogleCalendarApiService();

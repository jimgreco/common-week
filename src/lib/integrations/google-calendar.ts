import "server-only";

import type { CalendarAttendee, CalendarEvent, CalendarPreference, GoogleCalendarAccessRole } from "@/types/domain";

const GOOGLE_API = "https://www.googleapis.com/calendar/v3";

export interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  primary: boolean;
  backgroundColor: string;
  accessRole: GoogleCalendarAccessRole;
}

export interface GoogleCalendarEventInput {
  id?: string;
  summary: string;
  description?: string;
  location?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  recurrence?: string[];
  attendees?: Array<{ email: string }>;
}

export interface GoogleCalendarEventResource extends Omit<GoogleCalendarEventInput, "attendees"> {
  id: string;
  etag?: string;
  eventType?: string;
  recurringEventId?: string;
  originalStartTime?: { date?: string; dateTime?: string };
  htmlLink?: string;
  status?: string;
  recurrence?: string[];
  attendees?: CalendarAttendee[];
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
  searchEvents(
    accessToken: string,
    preference: CalendarPreference,
    query: string,
    timeMin: string,
    timeMax: string,
    timeZone: string,
    attribution: string,
  ): Promise<CalendarEvent[]>;
  getEvent(accessToken: string, calendarId: string, eventId: string): Promise<GoogleCalendarEventResource>;
  createEvent(accessToken: string, calendarId: string, event: GoogleCalendarEventInput): Promise<GoogleCalendarEventResource>;
  updateEvent(accessToken: string, calendarId: string, eventId: string, etag: string, event: GoogleCalendarEventInput): Promise<GoogleCalendarEventResource>;
  moveEvent(accessToken: string, sourceCalendarId: string, eventId: string, destinationCalendarId: string): Promise<GoogleCalendarEventResource>;
  patchEvent(accessToken: string, calendarId: string, eventId: string, etag: string, patch: Record<string, unknown>, sendUpdates?: "all" | "none"): Promise<GoogleCalendarEventResource>;
  deleteEvent(accessToken: string, calendarId: string, eventId: string, etag: string): Promise<void>;
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
  items?: GoogleCalendarEventResource[];
  nextPageToken?: string;
}

interface GoogleErrorResponse {
  error?: {
    status?: string;
    errors?: Array<{ reason?: string }>;
  };
}

export class GoogleCalendarApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly reason: string | null,
    public readonly googleStatus: string | null,
  ) {
    super(`Google Calendar returned ${statusCode}.`);
    this.name = "GoogleCalendarApiError";
  }
}

export function isGoogleCalendarApiDisabled(error: unknown): boolean {
  return error instanceof GoogleCalendarApiError &&
    error.statusCode === 403 &&
    (error.reason === "accessNotConfigured" || error.googleStatus === "SERVICE_DISABLED");
}

async function googleFetch<T>(url: URL, accessToken: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });

  if (response.status === 401) {
    throw new Error("GOOGLE_AUTH_REQUIRED");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as GoogleErrorResponse;
    throw new GoogleCalendarApiError(
      response.status,
      payload.error?.errors?.[0]?.reason ?? null,
      payload.error?.status ?? null,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function calendarAccessRole(value: string | undefined): GoogleCalendarAccessRole {
  return value === "freeBusyReader" || value === "writer" || value === "owner"
    ? value
    : "reader";
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
        accessRole: calendarAccessRole(item.accessRole),
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
        const event = mappedEvent(preference, item, attribution);
        if (event) events.push(event);
      }
      pageToken = payload.nextPageToken;
    } while (pageToken);

    return events;
  }

  async searchEvents(
    accessToken: string,
    preference: CalendarPreference,
    query: string,
    timeMin: string,
    timeMax: string,
    timeZone: string,
    attribution: string,
  ): Promise<CalendarEvent[]> {
    const events: CalendarEvent[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`${GOOGLE_API}/calendars/${encodeURIComponent(preference.googleCalendarId)}/events`);
      url.searchParams.set("q", query);
      url.searchParams.set("timeMin", timeMin);
      url.searchParams.set("timeMax", timeMax);
      url.searchParams.set("timeZone", timeZone);
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      url.searchParams.set("showDeleted", "false");
      url.searchParams.set("maxResults", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const payload = await googleFetch<GoogleEventsResponse>(url, accessToken);
      for (const item of payload.items ?? []) {
        const event = mappedEvent(preference, item, attribution);
        if (event) events.push(event);
      }
      pageToken = payload.nextPageToken;
    } while (pageToken && events.length < 100);
    return events.slice(0, 100);
  }

  async getEvent(accessToken: string, calendarId: string, eventId: string): Promise<GoogleCalendarEventResource> {
    return googleFetch<GoogleCalendarEventResource>(
      new URL(`${GOOGLE_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`),
      accessToken,
    );
  }

  async createEvent(accessToken: string, calendarId: string, event: GoogleCalendarEventInput): Promise<GoogleCalendarEventResource> {
    const url = new URL(`${GOOGLE_API}/calendars/${encodeURIComponent(calendarId)}/events`);
    if (event.attendees?.length) url.searchParams.set("sendUpdates", "all");
    return googleFetch<GoogleCalendarEventResource>(
      url,
      accessToken,
      { method: "POST", body: JSON.stringify(event) },
    );
  }

  async updateEvent(accessToken: string, calendarId: string, eventId: string, etag: string, event: GoogleCalendarEventInput): Promise<GoogleCalendarEventResource> {
    const url = new URL(`${GOOGLE_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    if (event.attendees?.length) url.searchParams.set("sendUpdates", "all");
    return googleFetch<GoogleCalendarEventResource>(
      url,
      accessToken,
      { method: "PATCH", headers: { "If-Match": etag }, body: JSON.stringify(event) },
    );
  }

  async moveEvent(accessToken: string, sourceCalendarId: string, eventId: string, destinationCalendarId: string): Promise<GoogleCalendarEventResource> {
    const url = new URL(`${GOOGLE_API}/calendars/${encodeURIComponent(sourceCalendarId)}/events/${encodeURIComponent(eventId)}/move`);
    url.searchParams.set("destination", destinationCalendarId);
    url.searchParams.set("sendUpdates", "none");
    return googleFetch<GoogleCalendarEventResource>(url, accessToken, { method: "POST" });
  }

  async patchEvent(accessToken: string, calendarId: string, eventId: string, etag: string, patch: Record<string, unknown>, sendUpdates: "all" | "none" = "none"): Promise<GoogleCalendarEventResource> {
    const url = new URL(`${GOOGLE_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    url.searchParams.set("sendUpdates", sendUpdates);
    return googleFetch<GoogleCalendarEventResource>(url, accessToken, {
      method: "PATCH",
      headers: { "If-Match": etag },
      body: JSON.stringify(patch),
    });
  }

  async deleteEvent(accessToken: string, calendarId: string, eventId: string, etag: string): Promise<void> {
    await googleFetch<void>(
      new URL(`${GOOGLE_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`),
      accessToken,
      { method: "DELETE", headers: { "If-Match": etag } },
    );
  }
}

function mappedEvent(
  preference: CalendarPreference,
  item: GoogleCalendarEventResource,
  attribution: string,
): CalendarEvent | null {
  if (!item.id || item.status === "cancelled" || !item.start || !item.end) return null;
  const allDay = Boolean(item.start.date);
  const start = item.start.dateTime ?? item.start.date;
  const end = item.end.dateTime ?? item.end.date;
  if (!start || !end) return null;
  return {
    id: `${preference.googleCalendarId}:${item.id}`,
    providerEventId: item.id,
    sourceUserId: preference.userId,
    calendarPreferenceId: preference.id,
    etag: item.etag,
    recurringEventId: item.recurringEventId,
    originalStartTime: item.originalStartTime?.dateTime ?? item.originalStartTime?.date,
    title: item.summary?.trim() || "Busy",
    description: item.description?.trim() || undefined,
    location: item.location?.trim() || undefined,
    googleUrl: item.htmlLink?.startsWith("https://") ? item.htmlLink : undefined,
    start,
    end,
    allDay,
    calendarId: preference.googleCalendarId,
    calendarName: preference.calendarName,
    calendarAlias: preference.displayAlias ?? preference.calendarName,
    calendarColor: preference.color,
    attribution,
    sectionGroup: preference.sectionGroup,
    attendees: item.attendees?.map((attendee) => ({
      email: attendee.email,
      displayName: attendee.displayName,
      responseStatus: attendee.responseStatus,
      self: attendee.self,
      organizer: attendee.organizer,
    })),
  };
}

export const googleCalendarService: GoogleCalendarService = new GoogleCalendarApiService();

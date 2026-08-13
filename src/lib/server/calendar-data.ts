import "server-only";

import { createHash } from "node:crypto";
import { fromZonedTime } from "date-fns-tz";
import { calendarAbbreviation, decorateCalendarEvents } from "@/lib/calendar-utils";
import { addDateDays } from "@/lib/date";
import { googleCalendarService, type GoogleCalendarListEntry } from "@/lib/integrations/google-calendar";
import { query, withTransaction } from "@/lib/server/database";
import { getGoogleAccessToken } from "@/lib/server/google-tokens";
import type { CalendarEvent, CalendarPreference, PlannerSourceState } from "@/types/domain";

interface MemberIdentity {
  userId: string;
}

interface CalendarBundle {
  events: CalendarEvent[];
  state: PlannerSourceState;
}

interface PreferenceRow {
  id: string;
  google_calendar_id: string;
  calendar_name: string;
  display_alias: string | null;
  display_abbreviation: string | null;
  color: string;
  is_selected: boolean;
  is_primary: boolean;
}

function attributionFor(preference: CalendarPreference): string {
  return preference.displayAbbreviation
    ?? calendarAbbreviation(preference.displayAlias ?? preference.calendarName);
}

function preferenceFromGoogle(
  householdId: string,
  userId: string,
  calendar: GoogleCalendarListEntry,
): Omit<CalendarPreference, "id"> & { householdId: string; userId: string } {
  return {
    householdId,
    userId,
    googleCalendarId: calendar.id,
    calendarName: calendar.summary,
    displayAlias: null,
    displayAbbreviation: null,
    color: calendar.backgroundColor,
    isSelected: true,
    isPrimary: calendar.primary,
  };
}

function mapPreferences(rows: PreferenceRow[]): CalendarPreference[] {
  return rows.map((row) => ({
    id: row.id,
    googleCalendarId: row.google_calendar_id,
    calendarName: row.calendar_name,
    displayAlias: row.display_alias,
    displayAbbreviation: row.display_abbreviation,
    color: row.color,
    isSelected: row.is_selected,
    isPrimary: row.is_primary,
  }));
}

async function readPreferences(householdId: string, userId: string) {
  return query<PreferenceRow>(
    `select id, google_calendar_id, calendar_name, display_alias, display_abbreviation,
            color, is_selected, is_primary
       from calendar_preferences
      where household_id = $1 and user_id = $2
      order by is_primary desc, calendar_name`,
    [householdId, userId],
  );
}

async function ensurePreferences(
  householdId: string,
  userId: string,
  accessToken: string,
  discoverNewCalendars = false,
): Promise<CalendarPreference[]> {
  const existing = await readPreferences(householdId, userId);
  if (!existing.rowCount || discoverNewCalendars) {
    const calendars = await googleCalendarService.listCalendars(accessToken);
    if (!calendars.length) return [];
    await withTransaction(async (database) => {
      for (const calendar of calendars) {
        const preference = preferenceFromGoogle(householdId, userId, calendar);
        await database.query(
          `insert into calendar_preferences (
             household_id, user_id, google_calendar_id, calendar_name, display_alias,
             display_abbreviation, color, is_selected, is_primary
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           on conflict (user_id, google_calendar_id) do update set
             calendar_name = excluded.calendar_name,
             color = excluded.color,
             is_primary = excluded.is_primary`,
          [
            preference.householdId,
            preference.userId,
            preference.googleCalendarId,
            preference.calendarName,
            preference.displayAlias,
            preference.displayAbbreviation,
            preference.color,
            preference.isSelected,
            preference.isPrimary,
          ],
        );
      }
    });
    return mapPreferences((await readPreferences(householdId, userId)).rows);
  }
  return mapPreferences(existing.rows);
}

async function eventsForMember(
  householdId: string,
  member: MemberIdentity,
  weekStart: string,
  timeZone: string,
): Promise<{ events: CalendarEvent[]; connected: boolean }> {
  const accessToken = await getGoogleAccessToken(member.userId);
  if (!accessToken) return { events: [], connected: false };
  try {
    const preferences = (await ensurePreferences(householdId, member.userId, accessToken)).filter(
      (preference) => preference.isSelected,
    );
    if (!preferences.length) return { events: [], connected: true };

    const timeMin = fromZonedTime(`${weekStart}T00:00:00`, timeZone).toISOString();
    const timeMax = fromZonedTime(`${addDateDays(weekStart, 7)}T00:00:00`, timeZone).toISOString();
    const cacheKey = createHash("sha256")
      .update(`${weekStart}:${timeZone}:${preferences.map((preference) => `${preference.id}:${preference.isSelected}`).join(",")}`)
      .digest("hex");
    const cached = await query<{ events: CalendarEvent[]; expires_at: Date }>(
      `select events, expires_at from calendar_event_cache
        where user_id = $1 and cache_key = $2`,
      [member.userId, cacheKey],
    );
    if (cached.rows[0] && cached.rows[0].expires_at.getTime() > Date.now()) {
      return { events: decorateCalendarEvents(cached.rows[0].events, preferences), connected: true };
    }

    const eventGroups = await Promise.all(
      preferences.map((preference) =>
        googleCalendarService.listEvents(
          accessToken,
          preference,
          timeMin,
          timeMax,
          timeZone,
          attributionFor(preference),
        ),
      ),
    );
    const events = decorateCalendarEvents(eventGroups.flat(), preferences);
    await query(
      `insert into calendar_event_cache (
         user_id, cache_key, window_start, window_end, events, expires_at
       ) values ($1, $2, $3, $4, $5::jsonb, $6)
       on conflict (user_id, cache_key) do update set
         window_start = excluded.window_start,
         window_end = excluded.window_end,
         events = excluded.events,
         expires_at = excluded.expires_at,
         created_at = now()`,
      [member.userId, cacheKey, timeMin, timeMax, JSON.stringify(events), new Date(Date.now() + 5 * 60_000)],
    );
    return { events, connected: true };
  } catch (error) {
    if (error instanceof Error && error.message === "GOOGLE_AUTH_REQUIRED") {
      await query("delete from google_connections where user_id = $1", [member.userId]);
      return { events: [], connected: false };
    }
    throw error;
  }
}

export async function getHouseholdCalendarEvents(
  householdId: string,
  members: MemberIdentity[],
  weekStart: string,
  timeZone: string,
): Promise<CalendarBundle> {
  try {
    const settled = await Promise.allSettled(
      members.map((member) => eventsForMember(householdId, member, weekStart, timeZone)),
    );
    const fulfilled = settled.filter(
      (result): result is PromiseFulfilledResult<{ events: CalendarEvent[]; connected: boolean }> =>
        result.status === "fulfilled",
    );
    const connected = fulfilled.some((result) => result.value.connected);
    const events = fulfilled.flatMap((result) => result.value.events);
    const failed = settled.some((result) => result.status === "rejected");
    return {
      events,
      state: failed
        ? { status: "error", message: "Some calendars could not be refreshed." }
        : connected
          ? { status: "ready" }
          : { status: "not-connected", message: "Connect Google Calendar in settings." },
    };
  } catch {
    return { events: [], state: { status: "error", message: "Calendar unavailable." } };
  }
}

export async function getCurrentUserCalendarPreferences(userId: string): Promise<CalendarPreference[]> {
  const member = await query<{ household_id: string }>(
    "select household_id from household_members where user_id = $1",
    [userId],
  );
  if (!member.rows[0]) return [];
  return mapPreferences((await readPreferences(member.rows[0].household_id, userId)).rows);
}

export async function refreshCurrentUserCalendarPreferences(
  householdId: string,
  userId: string,
): Promise<{ calendars: CalendarPreference[]; connected: boolean }> {
  const token = await getGoogleAccessToken(userId);
  if (!token) return { calendars: [], connected: false };
  const calendars = await ensurePreferences(householdId, userId, token, true);
  return { calendars, connected: true };
}

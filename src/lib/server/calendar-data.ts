import "server-only";

import { createHash } from "node:crypto";
import { fromZonedTime } from "date-fns-tz";
import { calendarAbbreviation, decorateCalendarEvents } from "@/lib/calendar-utils";
import { addDateDays } from "@/lib/date";
import { canHouseholdMemberWriteGoogleCalendar } from "@/lib/google-calendar-permissions";
import { googleCalendarService, type GoogleCalendarListEntry } from "@/lib/integrations/google-calendar";
import { query, withTransaction } from "@/lib/server/database";
import { GOOGLE_CALENDAR_WRITE_SCOPE, hasGoogleScope } from "@/lib/server/google-oauth";
import { getGoogleAccessToken } from "@/lib/server/google-tokens";
import type { CalendarEvent, CalendarPreference, GoogleCalendarAccessRole, PlannerSourceState } from "@/types/domain";

interface MemberIdentity {
  userId: string;
}

interface CalendarBundle {
  events: CalendarEvent[];
  state: PlannerSourceState;
}

interface PreferenceRow {
  id: string;
  user_id: string;
  google_calendar_id: string;
  calendar_name: string;
  display_alias: string | null;
  display_abbreviation: string | null;
  color: string;
  visibility: CalendarPreference["visibility"];
  is_primary: boolean;
  section_group: "critical" | "supplemental";
  access_role: CalendarPreference["accessRole"];
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
    // Calendar discovery must never expose a Google calendar in Week of Us.
    // Its owner chooses Hide, Private, or Share explicitly in Settings.
    visibility: "hide",
    isPrimary: calendar.primary,
    sectionGroup: "critical",
    accessRole: calendar.accessRole,
  };
}

function mapPreferences(rows: PreferenceRow[]): CalendarPreference[] {
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    googleCalendarId: row.google_calendar_id,
    calendarName: row.calendar_name,
    displayAlias: row.display_alias,
    displayAbbreviation: row.display_abbreviation,
    color: row.color,
    visibility: row.visibility,
    isPrimary: row.is_primary,
    sectionGroup: row.section_group,
    accessRole: row.access_role,
  }));
}

async function readPreferences(householdId: string, userId: string) {
  return query<PreferenceRow>(
    `select id, user_id, google_calendar_id, calendar_name, display_alias, display_abbreviation,
            color, visibility, is_primary, section_group, access_role
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
             display_abbreviation, color, is_selected, visibility, is_primary,
             section_group, access_role
           ) values ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, $10, $11)
           on conflict (user_id, google_calendar_id) do update set
             calendar_name = excluded.calendar_name,
             color = excluded.color,
             is_primary = excluded.is_primary,
             access_role = excluded.access_role`,
          [
            preference.householdId,
            preference.userId,
            preference.googleCalendarId,
            preference.calendarName,
            preference.displayAlias,
            preference.displayAbbreviation,
            preference.color,
            preference.visibility,
            preference.isPrimary,
            preference.sectionGroup,
            preference.accessRole,
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
  viewerUserId: string,
  weekStart: string,
  timeZone: string,
): Promise<{ events: CalendarEvent[]; connected: boolean }> {
  const accessToken = await getGoogleAccessToken(member.userId);
  if (!accessToken) return { events: [], connected: false };
  try {
    const preferences = (await ensurePreferences(householdId, member.userId, accessToken)).filter((preference) =>
      preference.visibility === "share"
      || (preference.visibility === "private" && member.userId === viewerUserId));
    if (!preferences.length) return { events: [], connected: true };

    const timeMin = fromZonedTime(`${weekStart}T00:00:00`, timeZone).toISOString();
    const timeMax = fromZonedTime(`${addDateDays(weekStart, 7)}T00:00:00`, timeZone).toISOString();
    const cacheKey = createHash("sha256")
      .update(`calendar-visibility-v1:${weekStart}:${timeZone}:${preferences.map((preference) => `${preference.id}:${preference.visibility}`).join(",")}`)
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
  viewerUserId: string,
  weekStart: string,
  timeZone: string,
): Promise<CalendarBundle> {
  try {
    const settled = await Promise.allSettled(
      members.map((member) => eventsForMember(householdId, member, viewerUserId, weekStart, timeZone)),
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

export async function searchHouseholdCalendarEvents(
  context: { userId: string; householdId: string },
  search: string,
): Promise<CalendarEvent[]> {
  const household = await query<{ timezone: string; actor_role: "owner" | "member" | "viewer" }>(
    `select h.timezone, hm.role as actor_role
       from households h join household_members hm on hm.household_id = h.id
      where h.id = $1 and hm.user_id = $2`,
    [context.householdId, context.userId],
  );
  const settings = household.rows[0];
  if (!settings) return [];
  const preferences = await query<PreferenceRow & {
    actor_access_role: GoogleCalendarAccessRole | null;
    actor_scope: string | null;
  }>(
    `select cp.id, cp.user_id, cp.google_calendar_id, cp.calendar_name, cp.display_alias,
            cp.display_abbreviation, cp.color, cp.visibility, cp.is_primary,
            cp.section_group, cp.access_role,
            actor_cp.access_role as actor_access_role, actor_gc.scope as actor_scope
       from calendar_preferences cp
       join google_connections owner_gc on owner_gc.user_id = cp.user_id
       left join calendar_preferences actor_cp
         on actor_cp.household_id = cp.household_id
        and actor_cp.user_id = $2
        and actor_cp.google_calendar_id = cp.google_calendar_id
       left join google_connections actor_gc on actor_gc.user_id = $2
      where cp.household_id = $1
        and (cp.visibility = 'share' or (cp.visibility = 'private' and cp.user_id = $2))`,
    [context.householdId, context.userId],
  );
  const timeMin = new Date(Date.now() - 365 * 24 * 60 * 60_000).toISOString();
  const timeMax = new Date(Date.now() + 2 * 365 * 24 * 60 * 60_000).toISOString();
  const groups = new Map<string, typeof preferences.rows>();
  for (const preference of preferences.rows) {
    groups.set(preference.user_id, [...(groups.get(preference.user_id) ?? []), preference]);
  }
  const eventGroups = await Promise.all(Array.from(groups.entries()).map(async ([ownerUserId, rows]) => {
    const token = await getGoogleAccessToken(ownerUserId);
    if (!token) return [];
    const results = await Promise.all(rows.map(async (row) => {
      const preference = mapPreferences([row])[0]!;
      const events = await googleCalendarService.searchEvents(
        token,
        preference,
        search,
        timeMin,
        timeMax,
        settings.timezone,
        attributionFor(preference),
      );
      const canEdit = canHouseholdMemberWriteGoogleCalendar({
        actorRole: settings.actor_role,
        actorUserId: context.userId,
        calendarOwnerUserId: row.user_id,
        visibility: row.visibility,
        actorAccessRole: row.actor_access_role,
        calendarWriteEnabled: hasGoogleScope(row.actor_scope, GOOGLE_CALENDAR_WRITE_SCOPE),
      });
      return events.map((event) => ({
        ...event,
        canEdit,
        canRespond: row.user_id === context.userId && Boolean(event.attendees?.some((attendee) => attendee.self)),
      }));
    }));
    return results.flat();
  }));
  const events = eventGroups.flat()
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 60);
  if (!events.length) return [];
  const reminders = await query<{ id: string; calendar_preference_id: string; provider_event_id: string; remind_at: Date }>(
    `select id, calendar_preference_id, provider_event_id, remind_at
       from notification_reminders
      where user_id = $1 and resource_kind = 'calendar_event' and delivered_at is null`,
    [context.userId],
  );
  const reminderByEvent = new Map(reminders.rows.map((row) => [
    `${row.calendar_preference_id}:${row.provider_event_id}`,
    { id: row.id, resourceKind: "calendar_event" as const, remindAt: row.remind_at.toISOString() },
  ]));
  return events.map((event) => ({
    ...event,
    reminder: event.calendarPreferenceId && event.providerEventId
      ? reminderByEvent.get(`${event.calendarPreferenceId}:${event.providerEventId}`) ?? null
      : null,
  }));
}

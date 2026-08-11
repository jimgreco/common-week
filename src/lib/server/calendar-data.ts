import "server-only";

import { createHash } from "node:crypto";
import { fromZonedTime } from "date-fns-tz";
import { addDateDays } from "@/lib/date";
import { googleCalendarService, type GoogleCalendarListEntry } from "@/lib/integrations/google-calendar";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGoogleAccessToken } from "@/lib/server/google-tokens";
import type { CalendarEvent, CalendarPreference, PlannerSourceState } from "@/types/domain";

interface MemberIdentity {
  userId: string;
  displayName: string;
}

interface CalendarBundle {
  events: CalendarEvent[];
  state: PlannerSourceState;
}

function attributionFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)![0]}` : parts[0]?.slice(0, 1) ?? "•").toUpperCase();
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
    color: calendar.backgroundColor,
    isSelected: true,
    isPrimary: calendar.primary,
  };
}

async function ensurePreferences(
  householdId: string,
  userId: string,
  accessToken: string,
  discoverNewCalendars = false,
): Promise<CalendarPreference[]> {
  const admin = createAdminClient();
  const { data: existing, error } = await admin
    .from("calendar_preferences")
    .select("id, google_calendar_id, calendar_name, display_alias, color, is_selected, is_primary")
    .eq("user_id", userId);
  if (error) throw new Error("Calendar preferences could not be loaded.");

  if (!existing?.length || discoverNewCalendars) {
    const calendars = await googleCalendarService.listCalendars(accessToken);
    if (!calendars.length) return [];
    const existingIds = new Set((existing ?? []).map((row) => row.google_calendar_id));
    const rows = calendars.filter((calendar) => !existingIds.has(calendar.id)).map((calendar) => {
      const preference = preferenceFromGoogle(householdId, userId, calendar);
      return {
        household_id: preference.householdId,
        user_id: preference.userId,
        google_calendar_id: preference.googleCalendarId,
        calendar_name: preference.calendarName,
        display_alias: preference.displayAlias,
        color: preference.color,
        is_selected: preference.isSelected,
        is_primary: preference.isPrimary,
      };
    });
    if (!rows.length) return mapPreferences(existing ?? []);
    const { data: inserted, error: insertError } = await admin
      .from("calendar_preferences")
      .insert(rows)
      .select("id, google_calendar_id, calendar_name, display_alias, color, is_selected, is_primary");
    if (insertError) throw new Error("Calendar preferences could not be initialized.");
    return mapPreferences([...(existing ?? []), ...(inserted ?? [])]);
  }

  return mapPreferences(existing);
}

function mapPreferences(rows: Array<Record<string, unknown>>): CalendarPreference[] {
  return rows.map((row) => ({
    id: String(row.id),
    googleCalendarId: String(row.google_calendar_id),
    calendarName: String(row.calendar_name),
    displayAlias: row.display_alias ? String(row.display_alias) : null,
    color: String(row.color),
    isSelected: Boolean(row.is_selected),
    isPrimary: Boolean(row.is_primary),
  }));
}

async function eventsForMember(
  householdId: string,
  member: MemberIdentity,
  weekStart: string,
  timeZone: string,
): Promise<{ events: CalendarEvent[]; connected: boolean }> {
  const accessToken = await getGoogleAccessToken(member.userId);
  if (!accessToken) return { events: [], connected: false };
  const admin = createAdminClient();
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
    const { data: cached } = await admin
      .from("calendar_event_cache")
      .select("events, expires_at")
      .eq("user_id", member.userId)
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (cached && new Date(cached.expires_at).getTime() > Date.now()) {
      return { events: cached.events as CalendarEvent[], connected: true };
    }

    const attribution = attributionFor(member.displayName);
    const eventGroups = await Promise.all(
      preferences.map((preference) =>
        googleCalendarService.listEvents(accessToken, preference, timeMin, timeMax, timeZone, attribution),
      ),
    );
    const events = eventGroups.flat();
    await admin.from("calendar_event_cache").upsert(
      {
        user_id: member.userId,
        cache_key: cacheKey,
        window_start: timeMin,
        window_end: timeMax,
        events,
        expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      },
      { onConflict: "user_id,cache_key" },
    );
    return { events, connected: true };
  } catch (error) {
    if (error instanceof Error && error.message === "GOOGLE_AUTH_REQUIRED") {
      await admin.from("google_connections").delete().eq("user_id", member.userId);
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
  try {
    const token = await getGoogleAccessToken(userId);
    if (!token) return [];
    const admin = createAdminClient();
    const { data: member } = await admin
      .from("household_members")
      .select("household_id")
      .eq("user_id", userId)
      .single();
    if (!member) return [];
    return ensurePreferences(member.household_id, userId, token, true);
  } catch {
    return [];
  }
}

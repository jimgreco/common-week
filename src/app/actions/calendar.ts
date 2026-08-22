"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { buildGoogleCalendarEventInput, deterministicGoogleEventId } from "@/lib/calendar-event-input";
import { isDateOnly } from "@/lib/date";
import { canHouseholdMemberWriteGoogleCalendar } from "@/lib/google-calendar-permissions";
import { GoogleCalendarApiError, googleCalendarService } from "@/lib/integrations/google-calendar";
import { requireHouseholdContext } from "@/lib/server/auth";
import { query } from "@/lib/server/database";
import { GOOGLE_CALENDAR_WRITE_SCOPE, hasGoogleScope } from "@/lib/server/google-oauth";
import { getGoogleAccessToken } from "@/lib/server/google-tokens";
import type { ActionResult, CalendarEventDraft, GoogleCalendarAccessRole } from "@/types/domain";

const dateOnly = z.string().refine(isDateOnly, "Choose a valid date.");
const eventDraftSchema = z.object({
  requestId: z.string().uuid(),
  calendarPreferenceId: z.string().uuid(),
  providerEventId: z.string().trim().min(1).max(1024).optional(),
  etag: z.string().trim().min(1).max(1024).optional(),
  title: z.string().trim().min(1).max(1000),
  description: z.string().max(8192),
  location: z.string().max(1000),
  allDay: z.boolean(),
  startDate: dateOnly,
  endDate: dateOnly,
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
}).refine((draft) => draft.endDate >= draft.startDate, {
  message: "End date must not be before the start date.",
});

interface WritableCalendarRow {
  calendar_owner_user_id: string;
  google_calendar_id: string;
  access_role: GoogleCalendarAccessRole;
  visibility: "hide" | "private" | "share";
  actor_role: "owner" | "member" | "viewer";
  scope: string | null;
  timezone: string;
}

async function requireWritableCalendar(calendarPreferenceId: string) {
  const context = await requireHouseholdContext();
  const result = await query<WritableCalendarRow>(
    `select cp.user_id as calendar_owner_user_id, cp.google_calendar_id, cp.access_role,
            cp.visibility, actor.role as actor_role, gc.scope, h.timezone
       from calendar_preferences cp
       join google_connections gc on gc.user_id = cp.user_id
       join households h on h.id = cp.household_id
       join household_members actor on actor.household_id = cp.household_id and actor.user_id = $3
      where cp.id = $1 and cp.household_id = $2`,
    [calendarPreferenceId, context.householdId, context.userId],
  );
  const calendar = result.rows[0];
  if (!calendar || !canHouseholdMemberWriteGoogleCalendar({
    actorRole: calendar.actor_role,
    actorUserId: context.userId,
    calendarOwnerUserId: calendar.calendar_owner_user_id,
    visibility: calendar.visibility,
    accessRole: calendar.access_role,
    calendarWriteEnabled: hasGoogleScope(calendar.scope, GOOGLE_CALENDAR_WRITE_SCOPE),
  })) {
    throw new Error("That calendar is not editable by this household member.");
  }
  const accessToken = await getGoogleAccessToken(calendar.calendar_owner_user_id);
  if (!accessToken) throw new Error("The person sharing this calendar needs to reconnect Google Calendar.");
  return { context, calendar, accessToken };
}

async function finishMutation(userId: string, householdId: string) {
  await query("delete from calendar_event_cache where user_id = $1", [userId]);
  await query(
    "select pg_notify('common_week_changes', json_build_object('householdId', $1::text, 'table', 'google_calendar_events')::text)",
    [householdId],
  );
  revalidatePath("/planner");
}

function mutationFailure(error: unknown): ActionResult {
  if (error instanceof z.ZodError) return { ok: false, error: "Check the event details and try again." };
  if (error instanceof GoogleCalendarApiError) {
    if (error.statusCode === 404) return { ok: false, error: "This event no longer exists in Google Calendar." };
    if (error.statusCode === 409 || error.statusCode === 412) return { ok: false, error: "This event changed in Google Calendar. Refresh the week and try again." };
    if (error.statusCode === 403) return { ok: false, error: "Google no longer allows edits to this calendar." };
    return { ok: false, error: "Google Calendar could not save this change. Your edits are still here." };
  }
  if (error instanceof Error && error.message === "GOOGLE_AUTH_REQUIRED") {
    return { ok: false, error: "Reconnect Google Calendar in Settings before changing events." };
  }
  return { ok: false, error: error instanceof Error ? error.message : "The Google Calendar event could not be saved." };
}

export async function createCalendarEventAction(input: CalendarEventDraft): Promise<ActionResult> {
  try {
    const draft = eventDraftSchema.parse(input);
    const { context, calendar, accessToken } = await requireWritableCalendar(draft.calendarPreferenceId);
    const providerEventId = deterministicGoogleEventId(draft.requestId);
    const eventInput = buildGoogleCalendarEventInput(draft, calendar.timezone, providerEventId);
    try {
      await googleCalendarService.createEvent(accessToken, calendar.google_calendar_id, eventInput);
    } catch (error) {
      if (!(error instanceof GoogleCalendarApiError) || error.statusCode !== 409) throw error;
      await googleCalendarService.getEvent(accessToken, calendar.google_calendar_id, providerEventId);
    }
    await finishMutation(calendar.calendar_owner_user_id, context.householdId);
    return { ok: true };
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function updateCalendarEventAction(input: CalendarEventDraft): Promise<ActionResult> {
  try {
    const draft = eventDraftSchema.parse(input);
    if (!draft.providerEventId || !draft.etag) throw new Error("Refresh the week before editing this event.");
    const { context, calendar, accessToken } = await requireWritableCalendar(draft.calendarPreferenceId);
    const current = await googleCalendarService.getEvent(accessToken, calendar.google_calendar_id, draft.providerEventId);
    if (!current.etag || current.etag !== draft.etag) {
      return { ok: false, error: "This event changed in Google Calendar. Refresh the week and try again." };
    }
    await googleCalendarService.updateEvent(
      accessToken,
      calendar.google_calendar_id,
      draft.providerEventId,
      current.etag,
      buildGoogleCalendarEventInput(draft, calendar.timezone),
    );
    await finishMutation(calendar.calendar_owner_user_id, context.householdId);
    return { ok: true };
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function deleteCalendarEventAction(input: Pick<CalendarEventDraft, "calendarPreferenceId" | "providerEventId" | "etag">): Promise<ActionResult> {
  try {
    const parsed = z.object({
      calendarPreferenceId: z.string().uuid(),
      providerEventId: z.string().trim().min(1).max(1024),
      etag: z.string().trim().min(1).max(1024),
    }).parse(input);
    const { context, calendar, accessToken } = await requireWritableCalendar(parsed.calendarPreferenceId);
    const current = await googleCalendarService.getEvent(accessToken, calendar.google_calendar_id, parsed.providerEventId);
    if (!current.etag || current.etag !== parsed.etag) {
      return { ok: false, error: "This event changed in Google Calendar. Refresh the week and try again." };
    }
    await googleCalendarService.deleteEvent(accessToken, calendar.google_calendar_id, parsed.providerEventId, current.etag);
    await finishMutation(calendar.calendar_owner_user_id, context.householdId);
    return { ok: true };
  } catch (error) {
    return mutationFailure(error);
  }
}

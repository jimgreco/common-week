"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { buildGoogleCalendarEventInput, buildGoogleCalendarSeriesInput, deterministicGoogleEventId } from "@/lib/calendar-event-input";
import { isDateOnly } from "@/lib/date";
import { canHouseholdMemberWriteGoogleCalendar } from "@/lib/google-calendar-permissions";
import { GoogleCalendarApiError, googleCalendarService } from "@/lib/integrations/google-calendar";
import { requireHouseholdContext } from "@/lib/server/auth";
import { query } from "@/lib/server/database";
import { GOOGLE_CALENDAR_WRITE_SCOPE, hasGoogleScope } from "@/lib/server/google-oauth";
import { getGoogleAccessToken } from "@/lib/server/google-tokens";
import { queueHouseholdChange } from "@/lib/server/notifications";
import type { ActionResult, CalendarEventDraft, CalendarResponseStatus, GoogleCalendarAccessRole } from "@/types/domain";

const dateOnly = z.string().refine(isDateOnly, "Choose a valid date.");
const recurrenceRuleSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval: z.number().int().min(1).max(99),
  weekdays: z.array(z.enum(["MO", "TU", "WE", "TH", "FR", "SA", "SU"])).max(7).optional(),
  ends: z.enum(["never", "onDate", "afterCount"]),
  untilDate: dateOnly.optional(),
  count: z.number().int().min(1).max(999).optional(),
}).superRefine((rule, context) => {
  if (rule.frequency === "weekly" && !rule.weekdays?.length) {
    context.addIssue({ code: "custom", message: "Choose at least one weekday." });
  }
  if (rule.ends === "onDate" && !rule.untilDate) {
    context.addIssue({ code: "custom", message: "Choose when the recurrence ends." });
  }
  if (rule.ends === "afterCount" && !rule.count) {
    context.addIssue({ code: "custom", message: "Choose how many occurrences to create." });
  }
});
const eventDraftSchema = z.object({
  requestId: z.string().uuid(),
  calendarPreferenceId: z.string().uuid(),
  sourceCalendarPreferenceId: z.string().uuid().optional(),
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
  recurringEventId: z.string().trim().min(1).max(1024).optional(),
  recurringScope: z.enum(["occurrence", "series"]).optional(),
  recurrence: recurrenceRuleSchema.optional(),
  guestEmails: z.array(z.string().trim().toLowerCase().email().max(320)).max(200).optional()
    .refine((emails) => !emails || new Set(emails).size === emails.length, "Remove duplicate guest emails."),
}).refine((draft) => draft.endDate >= draft.startDate, {
  message: "End date must not be before the start date.",
}).refine((draft) => !draft.recurrence || draft.recurrence.ends !== "onDate"
  || Boolean(draft.recurrence.untilDate && draft.recurrence.untilDate >= draft.startDate), {
  message: "The recurrence must not end before the event starts.",
});

interface WritableCalendarRow {
  calendar_owner_user_id: string;
  google_calendar_id: string;
  actor_access_role: GoogleCalendarAccessRole | null;
  visibility: "hide" | "private" | "share";
  actor_role: "owner" | "member" | "viewer";
  actor_scope: string | null;
  actor_google_connected: boolean;
  timezone: string;
}

async function requireWritableCalendar(calendarPreferenceId: string) {
  const context = await requireHouseholdContext();
  const result = await query<WritableCalendarRow>(
    `select cp.user_id as calendar_owner_user_id, cp.google_calendar_id,
            actor_cp.access_role as actor_access_role, cp.visibility,
            actor.role as actor_role, actor_gc.scope as actor_scope,
            (actor_gc.user_id is not null) as actor_google_connected, h.timezone
       from calendar_preferences cp
       join households h on h.id = cp.household_id
       join household_members actor on actor.household_id = cp.household_id and actor.user_id = $3
       left join calendar_preferences actor_cp
         on actor_cp.household_id = cp.household_id
        and actor_cp.user_id = actor.user_id
        and actor_cp.google_calendar_id = cp.google_calendar_id
       left join google_connections actor_gc on actor_gc.user_id = actor.user_id
      where cp.id = $1 and cp.household_id = $2`,
    [calendarPreferenceId, context.householdId, context.userId],
  );
  const calendar = result.rows[0];
  const calendarVisibleToActor = calendar && (
    calendar.calendar_owner_user_id === context.userId
      ? calendar.visibility !== "hide"
      : calendar.visibility === "share"
  );
  if (!calendar || calendar.actor_role === "viewer" || !calendarVisibleToActor) {
    throw new Error("That calendar is not editable by this household member.");
  }
  if (!calendar.actor_google_connected) {
    throw new Error("Connect your own Google Calendar before changing this event.");
  }
  if (!hasGoogleScope(calendar.actor_scope, GOOGLE_CALENDAR_WRITE_SCOPE)) {
    throw new Error("Enable Calendar editing for your Google account before changing this event.");
  }
  if (!calendar.actor_access_role) {
    throw new Error("Google has not shared this calendar with your account. Add it in Google Calendar, then refresh calendars in Settings.");
  }
  if (!canHouseholdMemberWriteGoogleCalendar({
    actorRole: calendar.actor_role,
    actorUserId: context.userId,
    calendarOwnerUserId: calendar.calendar_owner_user_id,
    visibility: calendar.visibility,
    actorAccessRole: calendar.actor_access_role,
    calendarWriteEnabled: true,
  })) {
    throw new Error("Your Google account has read-only access to this calendar. Ask its owner to grant permission to make changes, then refresh calendars in Settings.");
  }
  const accessToken = await getGoogleAccessToken(context.userId);
  if (!accessToken) throw new Error("Reconnect your own Google Calendar before changing this event.");
  return { context, calendar, accessToken };
}

async function finishMutation(householdId: string) {
  await query(
    `delete from calendar_event_cache cache
      using household_members member
      where cache.user_id = member.user_id and member.household_id = $1`,
    [householdId],
  );
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
    await finishMutation(context.householdId);
    await queueHouseholdChange({
      actorUserId: context.userId,
      householdId: context.householdId,
      title: `${context.displayName} added a calendar event`,
      body: draft.title,
    });
    return { ok: true };
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function updateCalendarEventAction(input: CalendarEventDraft): Promise<ActionResult> {
  try {
    const draft = eventDraftSchema.parse(input);
    if (!draft.providerEventId || !draft.etag) throw new Error("Refresh the week before editing this event.");
    const sourcePreferenceId = draft.sourceCalendarPreferenceId ?? draft.calendarPreferenceId;
    const { context, calendar: sourceCalendar, accessToken } = await requireWritableCalendar(sourcePreferenceId);
    const destination = draft.calendarPreferenceId === sourcePreferenceId
      ? { calendar: sourceCalendar }
      : await requireWritableCalendar(draft.calendarPreferenceId);
    const movingCalendars = destination.calendar.google_calendar_id !== sourceCalendar.google_calendar_id;
    if (movingCalendars && draft.recurringEventId && draft.recurringScope !== "series") {
      throw new Error("Choose Entire series before moving a recurring event to another calendar.");
    }
    const targetEventId = draft.recurringScope === "series" && draft.recurringEventId
      ? draft.recurringEventId
      : draft.providerEventId;
    const current = await googleCalendarService.getEvent(accessToken, sourceCalendar.google_calendar_id, targetEventId);
    if (!current.etag || (targetEventId === draft.providerEventId && current.etag !== draft.etag)) {
      return { ok: false, error: "This event changed in Google Calendar. Refresh the week and try again." };
    }
    if (movingCalendars && current.eventType && current.eventType !== "default") {
      throw new Error("Google only allows regular events to move between calendars.");
    }
    await googleCalendarService.updateEvent(
      accessToken,
      sourceCalendar.google_calendar_id,
      targetEventId,
      current.etag,
      targetEventId === draft.providerEventId
        ? buildGoogleCalendarEventInput(draft, sourceCalendar.timezone)
        : buildGoogleCalendarSeriesInput(draft, current, sourceCalendar.timezone),
    );
    if (movingCalendars) {
      try {
        await googleCalendarService.moveEvent(
          accessToken,
          sourceCalendar.google_calendar_id,
          targetEventId,
          destination.calendar.google_calendar_id,
        );
      } catch (error) {
        if (error instanceof GoogleCalendarApiError && error.statusCode === 400) {
          throw new Error("Google does not allow this event to move to that calendar.");
        }
        throw error;
      }
    }
    await finishMutation(context.householdId);
    await queueHouseholdChange({
      actorUserId: context.userId,
      householdId: context.householdId,
      title: `${context.displayName} updated ${targetEventId === draft.providerEventId ? "a calendar event" : "a recurring series"}`,
      body: draft.title,
    });
    return { ok: true };
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function deleteCalendarEventAction(input: Pick<CalendarEventDraft, "calendarPreferenceId" | "providerEventId" | "etag" | "recurringEventId" | "recurringScope">): Promise<ActionResult> {
  try {
    const parsed = z.object({
      calendarPreferenceId: z.string().uuid(),
      providerEventId: z.string().trim().min(1).max(1024),
      etag: z.string().trim().min(1).max(1024),
      recurringEventId: z.string().trim().min(1).max(1024).optional(),
      recurringScope: z.enum(["occurrence", "series"]).optional(),
    }).parse(input);
    const { context, calendar, accessToken } = await requireWritableCalendar(parsed.calendarPreferenceId);
    const targetEventId = parsed.recurringScope === "series" && parsed.recurringEventId
      ? parsed.recurringEventId
      : parsed.providerEventId;
    const current = await googleCalendarService.getEvent(accessToken, calendar.google_calendar_id, targetEventId);
    if (!current.etag || (targetEventId === parsed.providerEventId && current.etag !== parsed.etag)) {
      return { ok: false, error: "This event changed in Google Calendar. Refresh the week and try again." };
    }
    await googleCalendarService.deleteEvent(accessToken, calendar.google_calendar_id, targetEventId, current.etag);
    await finishMutation(context.householdId);
    await queueHouseholdChange({
      actorUserId: context.userId,
      householdId: context.householdId,
      title: `${context.displayName} removed ${targetEventId === parsed.providerEventId ? "a calendar event" : "a recurring series"}`,
      body: "Open Week of Us to see the updated shared week.",
    });
    return { ok: true };
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function respondToCalendarEventAction(input: {
  calendarPreferenceId: string;
  providerEventId: string;
  etag: string;
  responseStatus: CalendarResponseStatus;
}): Promise<ActionResult> {
  try {
    const parsed = z.object({
      calendarPreferenceId: z.string().uuid(),
      providerEventId: z.string().trim().min(1).max(1024),
      etag: z.string().trim().min(1).max(1024),
      responseStatus: z.enum(["needsAction", "declined", "tentative", "accepted"]),
    }).parse(input);
    const { context, calendar, accessToken } = await requireWritableCalendar(parsed.calendarPreferenceId);
    if (calendar.calendar_owner_user_id !== context.userId) {
      throw new Error("Respond from the Google account that received this invitation.");
    }
    const current = await googleCalendarService.getEvent(accessToken, calendar.google_calendar_id, parsed.providerEventId);
    if (!current.etag || current.etag !== parsed.etag) {
      return { ok: false, error: "This invitation changed in Google Calendar. Refresh the week and try again." };
    }
    const attendees = current.attendees ?? [];
    const selfIndex = attendees.findIndex((attendee) => attendee.self);
    if (selfIndex < 0) throw new Error("Google did not mark this account as an attendee.");
    const nextAttendees = attendees.map((attendee, index) => index === selfIndex ? { ...attendee, responseStatus: parsed.responseStatus } : attendee);
    await googleCalendarService.patchEvent(
      accessToken,
      calendar.google_calendar_id,
      parsed.providerEventId,
      current.etag,
      { attendees: nextAttendees },
      "all",
    );
    await finishMutation(context.householdId);
    return { ok: true };
  } catch (error) {
    return mutationFailure(error);
  }
}

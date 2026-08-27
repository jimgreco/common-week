"use server";

import { z } from "zod";
import { googleCalendarService } from "@/lib/integrations/google-calendar";
import { requireHouseholdContext } from "@/lib/server/auth";
import { postgresErrorCode, query } from "@/lib/server/database";
import { getGoogleAccessToken } from "@/lib/server/google-tokens";
import {
  getNotificationPreferences,
  saveNotificationPreferences,
  upsertCalendarReminder,
} from "@/lib/server/notifications";
import type { ActionResult, NotificationPreferences, NotificationReminder } from "@/types/domain";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const preferencesSchema = z.object({
  emailEnabled: z.boolean(),
  pushEnabled: z.boolean(),
  morningDigestEnabled: z.boolean(),
  morningDigestTime: time,
  sundayPlanningEnabled: z.boolean(),
  sundayPlanningTime: time,
  householdChangeAlerts: z.boolean(),
});

const futureInstant = z.string().datetime().transform((value, context) => {
  const date = new Date(value);
  if (date.getTime() <= Date.now() || date.getTime() > Date.now() + 5 * 365 * 24 * 60 * 60_000) {
    context.addIssue({ code: "custom", message: "Choose a future reminder time." });
    return z.NEVER;
  }
  return date;
});

export async function updateNotificationPreferencesAction(
  input: NotificationPreferences,
): Promise<ActionResult<NotificationPreferences>> {
  try {
    const context = await requireHouseholdContext();
    const preferences = preferencesSchema.parse(input);
    await saveNotificationPreferences(context.userId, preferences);
    return { ok: true, data: await getNotificationPreferences(context.userId) };
  } catch (error) {
    let errorMessage: string;
    if (error instanceof Error) {
      errorMessage = error.message;
    } else {
      const code = postgresErrorCode(error);
      errorMessage = code ? `Notification settings could not be saved. (error: ${code})` : "Notification settings could not be saved.";
    }
    console.error("Notification preferences error:", { error, errorMessage });
    return { ok: false, error: error instanceof z.ZodError ? "Check the notification settings and try again." : errorMessage };
  }
}

export async function setCalendarReminderAction(input: {
  calendarPreferenceId: string;
  providerEventId: string;
  remindAt: string | null;
}): Promise<ActionResult<NotificationReminder | null>> {
  try {
    const parsed = z.object({
      calendarPreferenceId: z.string().uuid(),
      providerEventId: z.string().trim().min(1).max(1024),
      remindAt: futureInstant.nullable(),
    }).parse(input);
    const context = await requireHouseholdContext();
    const result = await query<{
      google_calendar_id: string;
      calendar_owner_user_id: string;
      visibility: "hide" | "private" | "share";
    }>(
      `select cp.google_calendar_id, cp.user_id as calendar_owner_user_id, cp.visibility
         from calendar_preferences cp
        where cp.id = $1 and cp.household_id = $2
          and (cp.user_id = $3 or cp.visibility = 'share')`,
      [parsed.calendarPreferenceId, context.householdId, context.userId],
    );
    const calendar = result.rows[0];
    if (!calendar || calendar.visibility === "hide") throw new Error("That event is not visible to you.");
    const accessToken = await getGoogleAccessToken(calendar.calendar_owner_user_id);
    if (!accessToken) throw new Error("Reconnect Google Calendar before setting this reminder.");
    const event = await googleCalendarService.getEvent(accessToken, calendar.google_calendar_id, parsed.providerEventId);
    const startValue = event.start?.dateTime ?? event.start?.date;
    if (!startValue) throw new Error("The event start time is unavailable.");
    const eventStart = event.start?.date
      ? new Date(`${event.start.date}T09:00:00.000Z`)
      : new Date(startValue);
    const reminder = await upsertCalendarReminder({
      userId: context.userId,
      householdId: context.householdId,
      calendarPreferenceId: parsed.calendarPreferenceId,
      providerEventId: parsed.providerEventId,
      title: event.summary?.trim() || "Calendar event",
      eventStart,
      remindAt: parsed.remindAt,
    });
    return { ok: true, data: reminder };
  } catch (error) {
    let errorMessage: string;
    if (error instanceof Error) {
      errorMessage = error.message;
    } else {
      const code = postgresErrorCode(error);
      errorMessage = code ? `The reminder could not be saved. (error: ${code})` : "The reminder could not be saved.";
    }
    console.error("Calendar reminder error:", { error, errorMessage });
    if (error instanceof z.ZodError) return { ok: false, error: "Choose a valid future reminder time." };
    return { ok: false, error: errorMessage };
  }
}

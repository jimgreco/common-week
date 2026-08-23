"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { normalizeCalendarAbbreviation } from "@/lib/calendar-utils";
import { requireHouseholdContext, requireUserContext } from "@/lib/server/auth";
import { refreshCurrentUserCalendarPreferences } from "@/lib/server/calendar-data";
import { postgresErrorCode, query, withTransaction } from "@/lib/server/database";
import { isGoogleCalendarApiDisabled } from "@/lib/integrations/google-calendar";
import { deliverInvitation, invitationToken } from "@/lib/server/invitations";
import { permanentlyDeleteUser } from "@/lib/server/account-deletion";
import { deleteCurrentSession } from "@/lib/server/session";
import type { ActionResult, CalendarPreference } from "@/types/domain";

function errorResult(error: unknown, fallback: string): ActionResult {
  if (error instanceof z.ZodError || postgresErrorCode(error)) return { ok: false, error: fallback };
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export async function createHouseholdFromForm(formData: FormData) {
  const name = z.string().trim().min(1).max(80).parse(formData.get("name"));
  const timezone = z.string().refine(validTimeZone).parse(formData.get("timezone") || "America/New_York");
  const context = await requireUserContext();
  try {
    await withTransaction(async (database) => {
      const current = await database.query("select 1 from household_members where user_id = $1 for update", [context.userId]);
      if (current.rowCount) throw new Error("You already belong to a household.");
      const household = await database.query<{ id: string }>(
        "insert into households (name, timezone) values ($1, $2) returning id",
        [name, timezone],
      );
      await database.query(
        "insert into household_members (household_id, user_id, role) values ($1, $2, 'owner')",
        [household.rows[0].id, context.userId],
      );
    });
  } catch {
    redirect("/onboarding?error=household");
  }
  redirect("/settings?welcome=1");
}

export async function updateHouseholdAction(input: {
  name: string;
  timezone: string;
  temperatureUnit: "fahrenheit" | "celsius";
}): Promise<ActionResult> {
  try {
    const parsed = z.object({
      name: z.string().trim().min(1).max(80),
      timezone: z.string().refine(validTimeZone, "Choose a valid timezone."),
      temperatureUnit: z.enum(["fahrenheit", "celsius"]),
    }).parse(input);
    const context = await requireHouseholdContext();
    const result = await query(
      `update households set name = $2, timezone = $3, temperature_unit = $4::temperature_unit
        where id = $1`,
      [context.householdId, parsed.name, parsed.timezone, parsed.temperatureUnit],
    );
    if (!result.rowCount) throw new Error("Household preferences could not be saved.");
    revalidatePath("/settings");
    revalidatePath("/planner");
    return { ok: true };
  } catch (error) {
    return errorResult(error, "Household preferences could not be saved.");
  }
}

export async function inviteMemberAction(email: string): Promise<ActionResult> {
  try {
    const invitedEmail = z.string().trim().toLowerCase().email().max(320).parse(email);
    const context = await requireHouseholdContext();
    if (context.role !== "owner") throw new Error("Only the household owner can invite members.");
    if (invitedEmail === context.email.toLowerCase()) throw new Error("You already belong to this household.");

    const invite = await withTransaction(async (database) => {
      const existingMember = await database.query(
        `select 1 from users u
          join household_members hm on hm.user_id = u.id
         where u.email = $1 and hm.household_id = $2`,
        [invitedEmail, context.householdId],
      );
      if (existingMember.rowCount) throw new Error("That person already belongs to this household.");

      await database.query(
        `update household_invitations set status = 'revoked'
          where household_id = $1 and email = $2 and status = 'pending'`,
        [context.householdId, invitedEmail],
      );
      const generated = invitationToken();
      const result = await database.query<{ id: string; household_name: string }>(
        `insert into household_invitations (household_id, email, invited_by, token_hash)
         select h.id, $2, $3, $4 from households h where h.id = $1
         returning id, (select name from households where id = $1) as household_name`,
        [context.householdId, invitedEmail, context.userId, generated.hash],
      );
      return { ...result.rows[0], token: generated.token };
    });
    try {
      await deliverInvitation({ id: invite.id, email: invitedEmail, householdName: invite.household_name, inviterName: context.displayName, token: invite.token });
    } finally {
      revalidatePath("/settings");
    }
    return { ok: true };
  } catch (error) {
    return errorResult(error, "The invitation could not be created.");
  }
}

export async function resendInvitationAction(invitationId: string): Promise<ActionResult> {
  try {
    const id = z.string().uuid().parse(invitationId);
    const context = await requireHouseholdContext();
    if (context.role !== "owner") throw new Error("Only the household owner can resend invitations.");
    const generated = invitationToken();
    const result = await query<{ id: string; email: string; household_name: string }>(
      `update household_invitations i set token_hash = $3, expires_at = now() + interval '14 days',
         delivery_id = null, delivery_error = null
       from households h where i.id = $1 and i.household_id = $2 and i.household_id = h.id
         and i.status = 'pending'
       returning i.id, i.email::text, h.name as household_name`,
      [id, context.householdId, generated.hash],
    );
    const invite = result.rows[0];
    if (!invite) throw new Error("That invitation is no longer pending.");
    await deliverInvitation({ id, email: invite.email, householdName: invite.household_name, inviterName: context.displayName, token: generated.token });
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) { return errorResult(error, "The invitation could not be resent."); }
}

export async function cancelInvitationAction(invitationId: string): Promise<ActionResult> {
  try {
    const id = z.string().uuid().parse(invitationId);
    const context = await requireHouseholdContext();
    if (context.role !== "owner") throw new Error("Only the household owner can cancel invitations.");
    const result = await query(
      "update household_invitations set status = 'revoked', token_hash = null where id = $1 and household_id = $2 and status = 'pending'",
      [id, context.householdId],
    );
    if (!result.rowCount) throw new Error("That invitation is no longer pending.");
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) { return errorResult(error, "The invitation could not be canceled."); }
}

export async function removeMemberAction(memberId: string): Promise<ActionResult> {
  try {
    const id = z.string().uuid().parse(memberId);
    const context = await requireHouseholdContext();
    if (context.role !== "owner") throw new Error("Only the household owner can remove members.");
    const result = await query(
      `delete from household_members where id = $1 and household_id = $2 and user_id <> $3 and role <> 'owner'`,
      [id, context.householdId, context.userId],
    );
    if (!result.rowCount) throw new Error("That member cannot be removed.");
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) { return errorResult(error, "The member could not be removed."); }
}

export async function transferOwnershipAction(memberId: string): Promise<ActionResult> {
  try {
    const id = z.string().uuid().parse(memberId);
    const context = await requireHouseholdContext();
    if (context.role !== "owner") throw new Error("Only the household owner can transfer ownership.");
    await withTransaction(async (database) => {
      const target = await database.query<{ user_id: string }>(
        "select user_id from household_members where id = $1 and household_id = $2 and user_id <> $3 for update",
        [id, context.householdId, context.userId],
      );
      if (!target.rows[0]) throw new Error("Choose another household member.");
      await database.query("update household_members set role = 'member' where household_id = $1 and user_id = $2", [context.householdId, context.userId]);
      await database.query("update household_members set role = 'owner' where household_id = $1 and user_id = $2", [context.householdId, target.rows[0].user_id]);
    });
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) { return errorResult(error, "Ownership could not be transferred."); }
}

export async function leaveHouseholdAction(): Promise<ActionResult> {
  try {
    const context = await requireHouseholdContext();
    if (context.role === "owner") throw new Error("Transfer ownership before leaving the household.");
    await query("delete from household_members where household_id = $1 and user_id = $2", [context.householdId, context.userId]);
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) { return errorResult(error, "You could not leave the household."); }
}

export async function deleteAccountAction(confirmation: string): Promise<ActionResult> {
  try {
    if (confirmation !== "DELETE") throw new Error("Type DELETE to confirm.");
    const context = await requireUserContext();
    await permanentlyDeleteUser(context.userId);
    await deleteCurrentSession();
    return { ok: true };
  } catch (error) { return errorResult(error, "Your account could not be deleted."); }
}

export async function addLocationAction(input: {
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = z.object({
      name: z.string().trim().min(1).max(120),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      timezone: z.string().refine(validTimeZone),
    }).parse(input);
    const context = await requireHouseholdContext();
    const result = await query<{ id: string }>(
      `insert into locations (household_id, name, latitude, longitude, timezone, is_saved)
       values ($1, $2, $3, $4, $5, true) returning id`,
      [context.householdId, parsed.name, parsed.latitude, parsed.longitude, parsed.timezone],
    );
    revalidatePath("/settings");
    revalidatePath("/planner");
    return { ok: true, data: { id: result.rows[0].id } };
  } catch (error) {
    if (postgresErrorCode(error) === "23505") {
      return { ok: false, error: "A saved location with that name already exists.", data: undefined };
    }
    return { ...errorResult(error, "The location could not be added."), data: undefined };
  }
}

export async function setDefaultLocationAction(locationId: string): Promise<ActionResult> {
  try {
    const parsedId = z.string().uuid().parse(locationId);
    const context = await requireHouseholdContext();
    const result = await query(
      `update households h set default_location_id = $2
        where h.id = $1 and exists (
          select 1 from locations l where l.id = $2 and l.household_id = h.id
        )`,
      [context.householdId, parsedId],
    );
    if (!result.rowCount) throw new Error("That location is not available.");
    revalidatePath("/settings");
    revalidatePath("/planner");
    return { ok: true };
  } catch (error) {
    return errorResult(error, "The default location could not be changed.");
  }
}

export async function removeLocationAction(locationId: string): Promise<ActionResult> {
  try {
    const parsedId = z.string().uuid().parse(locationId);
    const context = await requireHouseholdContext();
    const result = await query(
      "delete from locations where id = $1 and household_id = $2",
      [parsedId, context.householdId],
    );
    if (!result.rowCount) throw new Error("That location is not available.");
    revalidatePath("/settings");
    revalidatePath("/planner");
    return { ok: true };
  } catch (error) {
    return errorResult(error, "The location could not be removed.");
  }
}

export async function updateCalendarPreferenceAction(input: {
  id: string;
  visibility: "hide" | "private" | "share";
  displayAlias: string | null;
  displayAbbreviation: string | null;
  sectionGroup: "critical" | "supplemental";
}): Promise<ActionResult> {
  try {
    const parsed = z.object({
      id: z.string().uuid(),
      visibility: z.enum(["hide", "private", "share"]),
      displayAlias: z.string().trim().min(1).max(40).nullable(),
      displayAbbreviation: z.string().trim().min(1).max(2)
        .regex(/^[\p{L}\p{N}]{1,2}$/u)
        .transform(normalizeCalendarAbbreviation)
        .nullable(),
      sectionGroup: z.enum(["critical", "supplemental"]),
    }).parse(input);
    const context = await requireHouseholdContext();
    await withTransaction(async (database) => {
      const result = await database.query<{ google_calendar_id: string }>(
        `update calendar_preferences set
           visibility = $4, is_selected = ($4 = 'share'),
           display_alias = $5, display_abbreviation = $6, section_group = $7
          where id = $1 and household_id = $2 and user_id = $3
          returning google_calendar_id`,
        [
          parsed.id,
          context.householdId,
          context.userId,
          parsed.visibility,
          parsed.displayAlias,
          parsed.displayAbbreviation,
          parsed.sectionGroup,
        ],
      );
      const calendar = result.rows[0];
      if (!calendar) throw new Error("That calendar is not available.");

      // A changed sharing decision receives a new cache boundary immediately.
      // If nobody else shares the same Google calendar, also discard household
      // hide records that contain provider event titles from that calendar.
      await database.query("delete from calendar_event_cache where user_id = $1", [context.userId]);
      if (parsed.visibility !== "share") {
        await database.query(
          `delete from hidden_calendar_events hce
            where hce.household_id = $1
              and left(hce.event_id, char_length($2) + 1) = $2 || ':'
              and not exists (
                select 1
                  from calendar_preferences cp
                 where cp.household_id = $1
                   and cp.google_calendar_id = $2
                   and cp.visibility = 'share'
              )`,
          [context.householdId, calendar.google_calendar_id],
        );
      }
    });
    revalidatePath("/settings");
    revalidatePath("/planner");
    return { ok: true };
  } catch (error) {
    return errorResult(error, "Calendar preference could not be saved.");
  }
}

export async function restoreCalendarEventAction(hiddenEventId: string): Promise<ActionResult> {
  try {
    const parsedId = z.string().uuid().parse(hiddenEventId);
    const context = await requireHouseholdContext();
    const result = await query(
      "delete from hidden_calendar_events where id = $1 and household_id = $2",
      [parsedId, context.householdId],
    );
    if (!result.rowCount) throw new Error("That hidden event is not available.");
    revalidatePath("/settings");
    revalidatePath("/planner");
    return { ok: true };
  } catch (error) {
    return errorResult(error, "The event could not be restored.");
  }
}

export async function refreshGoogleCalendarsAction(): Promise<ActionResult<{
  calendars: CalendarPreference[];
  connected: boolean;
}>> {
  try {
    const context = await requireHouseholdContext();
    const refreshed = await refreshCurrentUserCalendarPreferences(context.householdId, context.userId);
    if (!refreshed.connected) {
      return {
        ok: false,
        error: "Reconnect Google Calendar to refresh your calendars.",
        data: refreshed,
      };
    }
    return { ok: true, data: refreshed };
  } catch (error) {
    if (isGoogleCalendarApiDisabled(error)) {
      console.warn("Google Calendar discovery failed because the Calendar API is disabled.");
      return {
        ok: false,
        error: "Google Calendar API needs to be enabled by the app owner. Your planner is still available.",
      };
    }
    console.warn("Google Calendar discovery failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      ok: false,
      error: "Google calendars could not be refreshed. Your planner is still available.",
    };
  }
}

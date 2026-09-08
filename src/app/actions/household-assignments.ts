"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireHouseholdContext } from "@/lib/server/auth";
import { withTransaction } from "@/lib/server/database";
import { assignedMembersSchema, validateAssignedMembers } from "@/lib/server/household-assignments";
import type { ActionResult } from "@/types/domain";

export async function saveEventMembersAction(input: { calendarPreferenceId: string; providerEventId: string; memberIds: string[] | null }): Promise<ActionResult> {
  try {
    const parsed = z.object({ calendarPreferenceId: z.string().uuid(), providerEventId: z.string().min(1).max(1024), memberIds: assignedMembersSchema.nullable() }).parse(input);
    const context = await requireHouseholdContext();
    if (context.role === "viewer") throw new Error("You do not have permission to change this household.");
    await withTransaction(async (database) => {
      const calendar = await database.query(`select id from calendar_preferences where id=$1 and household_id=$2 and (visibility='share' or (visibility='private' and user_id=$3)) for update`, [parsed.calendarPreferenceId,context.householdId,context.userId]);
      if (!calendar.rows[0]) throw new Error("That calendar is not available to you.");
      await validateAssignedMembers(context.householdId, parsed.memberIds ?? undefined, database);
      if (parsed.memberIds === null) await database.query("delete from event_member_overrides where calendar_preference_id=$1 and provider_event_id=$2", [parsed.calendarPreferenceId,parsed.providerEventId]);
      else await database.query(`insert into event_member_overrides(household_id,calendar_preference_id,provider_event_id,assigned_member_ids) values($1,$2,$3,$4::uuid[])
        on conflict(calendar_preference_id,provider_event_id) do update set assigned_member_ids=excluded.assigned_member_ids`, [context.householdId,parsed.calendarPreferenceId,parsed.providerEventId,parsed.memberIds]);
    });
    revalidatePath("/planner");
    return { ok: true };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Assignments could not be saved." }; }
}

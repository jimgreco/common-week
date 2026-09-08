import "server-only";
export { assignedMembersSchema } from "@/lib/household-assignments";
import { query } from "@/lib/server/database";
import type { CalendarEvent } from "@/types/domain";



export async function validateAssignedMembers(householdId: string, ids?: string[], database: { query: typeof query } = { query }) {
  if (!ids?.length) return;
  const result = await database.query<{ id: string }>(`select user_id as id from household_members where household_id=$1 and user_id=any($2::uuid[])
    union select id from child_profiles where household_id=$1 and id=any($2::uuid[])`, [householdId, ids]);
  if (result.rows.length !== ids.length) throw new Error("Choose members of this household.");
}

export async function assignCalendarMembers(householdId: string, events: CalendarEvent[]): Promise<CalendarEvent[]> {
  if (!events.length) return events;
  const [links, overrides] = await Promise.all([
    query<{ calendar_id: string; member_id: string }>(`select calendar_preference_id as calendar_id,user_id as member_id from adult_calendar_links where household_id=$1
      union select cl.calendar_preference_id,c.id from child_calendar_links cl join child_profiles c on c.id=cl.child_id where c.household_id=$1`, [householdId]),
    query<{ calendar_preference_id: string; provider_event_id: string; assigned_member_ids: string[] }>("select calendar_preference_id,provider_event_id,assigned_member_ids from event_member_overrides where household_id=$1 and calendar_preference_id=any($2::uuid[])", [householdId, [...new Set(events.flatMap((event) => event.calendarPreferenceId ? [event.calendarPreferenceId] : []))]]),
  ]);
  return events.map((event) => {
    const defaults = links.rows.filter((link) => link.calendar_id === event.calendarPreferenceId).map((link) => link.member_id);
    const override = overrides.rows.find((row) => row.calendar_preference_id === event.calendarPreferenceId && row.provider_event_id === event.providerEventId);
    return { ...event, defaultMemberIds: defaults, memberOverrideIds: override?.assigned_member_ids ?? null, assignedMemberIds: override?.assigned_member_ids ?? defaults };
  });
}

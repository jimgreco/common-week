import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { todayInTimeZone } from "@/lib/date";
import { familyDateOffset, familyMutationSchema, familyWeekSchema, familyWeekStart, routineOccurrencesForWeek } from "@/lib/family-planning";
import { query, withTransaction } from "@/lib/server/database";
import type { FamilyPlanningData, FamilyPlanningMutation, PlanningItem, TaskRoutine, WeekTemplateItem } from "@/types/domain";

type Context = { householdId: string; userId: string };
const routineColumns = `id, text, child_id as "childId", frequency, interval, weekdays,
  starts_on::text as "startsOn", ends_on::text as "endsOn", active`;

async function access(context: Context, database: { query: typeof query }, edit = false) {
  const result = await database.query<{ role: string; timezone: string }>(
    `select hm.role, h.timezone from household_members hm join households h on h.id = hm.household_id
      where hm.household_id = $1 and hm.user_id = $2`, [context.householdId, context.userId],
  );
  const membership = result.rows[0];
  if (!membership || (edit && membership.role === "viewer")) throw new Error("You do not have permission to change this household.");
  return membership;
}

export async function validateChildForHousehold(householdId: string, childId: string | null | undefined, database: { query: typeof query } = { query }) {
  if (!childId) return;
  const result = await database.query("select id from child_profiles where household_id = $1 and id = $2", [householdId, childId]);
  if (!result.rows[0]) throw new Error("That child is not available to this household.");
}

async function lockHousehold(database: PoolClient, householdId: string) {
  // One transaction-level lock coordinates lazy generation and routine editing.
  await database.query("select pg_advisory_xact_lock(hashtextextended($1, 15))", [householdId]);
}

async function materialize(database: PoolClient, context: Context, weekStart: string, timezone: string) {
  const currentWeek = familyWeekStart(todayInTimeZone(timezone));
  // Browsing history never writes new tasks. Bound future generation to two years.
  if (weekStart < currentWeek || weekStart > familyDateOffset(currentWeek, 728)) return;
  const routines = await database.query<TaskRoutine & { createdBy: string }>(
    `select ${routineColumns}, created_by as "createdBy" from task_routines where household_id = $1 and active order by created_at limit 100`,
    [context.householdId],
  );
  for (const routine of routines.rows) {
    for (const occurrence of routineOccurrencesForWeek(routine, weekStart)) {
      const claimed = await database.query(
        `insert into task_routine_occurrences (routine_id, occurrence_date) values ($1, $2::date)
         on conflict do nothing returning routine_id`, [routine.id, occurrence.occurrenceDate],
      );
      if (!claimed.rows[0]) continue;
      const item = await database.query<{ id: string }>(
        `insert into planning_items (household_id,created_by,planning_date,week_start_date,type,text,child_id,routine_id,routine_occurrence_date)
         values ($1,$2,$3::date,$4::date,'task',$5,$6,$7,$8::date) returning id`,
        [context.householdId, routine.createdBy, occurrence.planningDate, weekStart, routine.text, routine.childId, routine.id, occurrence.occurrenceDate],
      );
      await database.query("update task_routine_occurrences set item_id = $3 where routine_id = $1 and occurrence_date = $2::date",
        [routine.id, occurrence.occurrenceDate, item.rows[0].id]);
    }
  }
}

export async function materializeTaskRoutines(context: Context, weekStart: string, timezone: string) {
  familyWeekSchema.parse(weekStart);
  await withTransaction(async (database) => {
    await access(context, database);
    await lockHousehold(database, context.householdId);
    await materialize(database, context, weekStart, timezone);
  });
}

export async function getFamilyPlanningData(context: Context, requestedWeek: string): Promise<FamilyPlanningData> {
  const weekStart = familyWeekSchema.parse(requestedWeek);
  const membership = await access(context, { query });
  const [adults, children, routines, templates, reviewRows, acknowledgements, openTasks] = await Promise.all([
    query<FamilyPlanningData["adults"][number]>(
      `select hm.user_id as "userId",u.display_name as "displayName",
        coalesce(array_agg(cp.id::text) filter(where cp.id is not null),'{}') as "calendarPreferenceIds"
       from household_members hm join users u on u.id=hm.user_id
       left join adult_calendar_links al on al.household_id=hm.household_id and al.user_id=hm.user_id
       left join calendar_preferences cp on cp.id=al.calendar_preference_id and cp.household_id=hm.household_id
         and (cp.visibility='share' or (cp.user_id=$2 and cp.visibility='private'))
       where hm.household_id=$1 group by hm.user_id,u.display_name,hm.created_at order by hm.created_at`, [context.householdId,context.userId]),
    query<FamilyPlanningData["children"][number]>(
      `select c.id,c.name,c.color,coalesce(array_agg(cp.id::text) filter(where cp.id is not null),'{}') as "calendarPreferenceIds"
       from child_profiles c left join child_calendar_links cl on cl.child_id = c.id
       left join calendar_preferences cp on cp.id = cl.calendar_preference_id and cp.household_id = c.household_id
         and (cp.visibility = 'share' or (cp.user_id = $2 and cp.visibility = 'private'))
       where c.household_id = $1 group by c.id order by c.created_at`, [context.householdId, context.userId]),
    query<TaskRoutine>(`select ${routineColumns} from task_routines where household_id=$1 order by created_at`, [context.householdId]),
    query<FamilyPlanningData["templates"][number]>(
      `select t.id,t.name,t.items,exists(select 1 from week_template_applications a where a.template_id=t.id and a.week_start_date=$2::date) as "appliedToWeek"
       from week_templates t where t.household_id=$1 order by t.created_at`, [context.householdId, weekStart]),
    query<{ priorities: string; meals: string; logistics: string; revision: number }>(
      "select priorities,meals,logistics,revision from weekly_reviews where household_id=$1 and week_start_date=$2::date", [context.householdId, weekStart]),
    query<{ userId: string; displayName: string; reviewedAt: Date }>(
      `select a.user_id as "userId",u.display_name as "displayName",a.reviewed_at as "reviewedAt"
       from weekly_review_acknowledgements a join weekly_reviews r using(household_id,week_start_date)
       join users u on u.id=a.user_id join household_members hm on hm.user_id=a.user_id and hm.household_id=a.household_id
       where a.household_id=$1 and a.week_start_date=$2::date and a.revision=r.revision order by a.reviewed_at`, [context.householdId, weekStart]),
    query<Omit<PlanningItem, "updatedAt"> & { updatedAt: Date }>(
      `select pi.id,pi.planning_date::text as "planningDate",pi.week_start_date::text as "weekStartDate",pi.type,pi.text,
       pi.is_completed as "isCompleted",pi.sort_order as "sortOrder",pi.created_by as "createdBy",u.display_name as "createdByName",
       pi.updated_at as "updatedAt",pi.child_id as "childId",pi.routine_id as "routineId",pi.routine_occurrence_date::text as "routineOccurrenceDate",
       pi.original_planning_date::text as "originalPlanningDate",pi.original_week_start_date::text as "originalWeekStartDate",pi.carryover_count as "carryoverCount"
       from planning_items pi join users u on u.id=pi.created_by
       where pi.household_id=$1 and pi.type='task' and not pi.is_completed and pi.week_start_date < $2::date
       order by pi.week_start_date desc,pi.sort_order,pi.created_at limit 100`, [context.householdId, weekStart]),
  ]);
  return {
    weekStart, currentUserId: context.userId, canEdit: membership.role !== "viewer", adults: adults.rows, children: children.rows,
    routines: routines.rows, templates: templates.rows, openTasks: openTasks.rows.map((item) => ({ ...item, updatedAt: item.updatedAt.toISOString() })),
    review: { weekStart, ...(reviewRows.rows[0] ?? { priorities: "", meals: "", logistics: "", revision: 0 }),
      reviewedBy: acknowledgements.rows.map((ack) => ({ ...ack, reviewedAt: ack.reviewedAt.toISOString() })) },
  };
}

async function requireAvailable(database: PoolClient, table: "child_profiles" | "task_routines" | "week_templates", context: Context, id: string) {
  const result = await database.query(`select id from ${table} where id=$1 and household_id=$2`, [id, context.householdId]);
  if (!result.rows[0]) throw new Error("That item is not available to this household.");
}

async function enforceLimit(database: PoolClient, table: "child_profiles" | "task_routines" | "week_templates", context: Context, limit: number) {
  const result = await database.query<{ count: string }>(`select count(*)::text from ${table} where household_id=$1`, [context.householdId]);
  if (Number(result.rows[0].count) >= limit) throw new Error(`This household has reached its limit of ${limit} items. Remove an unused item first.`);
}

async function removeFutureRoutineItems(database: PoolClient, context: Context, id: string, today: string, excludingItemId?: string, replacement?: TaskRoutine) {
  // Only untouched future placements belong to the series. An occurrence that
  // someone rescheduled, rewrote, or reassigned has become an explicit plan.
  const future = await database.query<{ id: string; occurrence_date: string; planning_date: string | null }>(
    `select pi.id,pi.routine_occurrence_date::text as occurrence_date,pi.planning_date::text
     from planning_items pi join task_routines r on r.id=pi.routine_id
     where pi.household_id=$1 and pi.routine_id=$2 and not pi.is_completed and pi.type='task'
      and pi.text=r.text and pi.child_id is not distinct from r.child_id
      and ((pi.planning_date=pi.routine_occurrence_date and pi.planning_date > $3::date)
       or (pi.planning_date is null and pi.week_start_date=pi.routine_occurrence_date and pi.week_start_date > $4::date))
      and ($5::uuid is null or pi.id <> $5::uuid) for update of pi`,
    [context.householdId, id, today, familyWeekStart(today), excludingItemId ?? null],
  );
  const removed: string[] = [];
  for (const item of future.rows) {
    const matching = replacement && routineOccurrencesForWeek(replacement, familyWeekStart(item.occurrence_date))
      .some((occurrence) => occurrence.occurrenceDate === item.occurrence_date && occurrence.planningDate === item.planning_date);
    if (matching) {
      // Keep occurrence IDs and reminders when the date still belongs to the
      // edited series. Repeated reads and retries can then use the same ledger.
      await database.query("update planning_items set text=$3,child_id=$4 where id=$1 and household_id=$2", [item.id,context.householdId,replacement!.text,replacement!.childId]);
    } else removed.push(item.id);
  }
  if (!removed.length) return;
  await database.query("delete from task_routine_occurrences where routine_id=$1 and item_id=any($2::uuid[])", [id, removed]);
  await database.query("delete from planning_items where household_id=$1 and id=any($2::uuid[])", [context.householdId, removed]);
}

export async function mutateFamilyPlanning(context: Context, input: FamilyPlanningMutation): Promise<FamilyPlanningData> {
  const parsed = familyMutationSchema.parse(input);
  await withTransaction(async (database) => {
    const membership = await access(context, database, true);
    await lockHousehold(database, context.householdId);
    switch (parsed.action) {
      case "saveAdultCalendars": {
        const adult = await database.query("select 1 from household_members where household_id=$1 and user_id=$2 for update", [context.householdId,parsed.userId]);
        if (!adult.rows[0]) throw new Error("That adult is not a member of this household.");
        const calendars = await database.query(`select id from calendar_preferences where household_id=$1 and id=any($2::uuid[])
          and (visibility='share' or (user_id=$3 and visibility='private'))`, [context.householdId,parsed.calendarPreferenceIds,context.userId]);
        if (calendars.rows.length !== parsed.calendarPreferenceIds.length) throw new Error("Choose calendars visible to you in this household.");
        // A partial view must not remove links to another adult's private calendars.
        await database.query(`delete from adult_calendar_links al using calendar_preferences cp
          where al.household_id=$1 and al.user_id=$2 and cp.id=al.calendar_preference_id
          and (cp.visibility='share' or (cp.user_id=$3 and cp.visibility='private'))`, [context.householdId,parsed.userId,context.userId]);
        for (const calendarId of parsed.calendarPreferenceIds) await database.query("insert into adult_calendar_links(household_id,user_id,calendar_preference_id) values($1,$2,$3) on conflict do nothing", [context.householdId,parsed.userId,calendarId]);
        break;
      }
      case "saveChild": {
        const child = parsed.child;
        if (child.calendarPreferenceIds.length) {
          const calendars = await database.query<{ id: string }>(
            `select id from calendar_preferences where household_id=$1 and id=any($2::uuid[])
             and (visibility='share' or (user_id=$3 and visibility='private'))`, [context.householdId, child.calendarPreferenceIds, context.userId]);
          if (calendars.rows.length !== child.calendarPreferenceIds.length) throw new Error("Choose calendars visible to you in this household.");
        }
        const id = child.id ?? randomUUID();
        const existing = await database.query<{ household_id: string }>("select household_id from child_profiles where id=$1", [id]);
        if (existing.rows[0] && existing.rows[0].household_id !== context.householdId) throw new Error("That child is not available to this household.");
        if (!existing.rows[0]) await enforceLimit(database, "child_profiles", context, 20);
        await database.query(`insert into child_profiles(id,household_id,name,color) values($1,$2,$3,$4)
          on conflict(id) do update set name=excluded.name,color=excluded.color where child_profiles.household_id=excluded.household_id`, [id,context.householdId,child.name,child.color]);
        // Preserve links private to another adult; a partial visible profile must
        // not silently remove that adult's calendar associations on save.
        await database.query(`delete from child_calendar_links cl using calendar_preferences cp where cl.child_id=$1 and cp.id=cl.calendar_preference_id
          and (cp.visibility='share' or (cp.user_id=$2 and cp.visibility='private'))`, [id, context.userId]);
        for (const calendarId of child.calendarPreferenceIds) await database.query("insert into child_calendar_links values($1,$2) on conflict do nothing", [id,calendarId]);
        break;
      }
      case "deleteChild":
        await requireAvailable(database, "child_profiles", context, parsed.id);
        await database.query("delete from child_profiles where id=$1 and household_id=$2", [parsed.id,context.householdId]);
        // Templates are snapshots; remove deleted profile references as well.
        await database.query(`update week_templates set items=(select coalesce(jsonb_agg(case when item->>'childId'=$2 then item || '{"childId":null}'::jsonb else item end),'[]'::jsonb) from jsonb_array_elements(items) item) where household_id=$1`, [context.householdId,parsed.id]);
        break;
      case "saveRoutine": {
        const routine = parsed.routine;
        await validateChildForHousehold(context.householdId, routine.childId, database);
        const id = routine.id ?? randomUUID();
        const existing = await database.query<TaskRoutine & { household_id: string }>(`select ${routineColumns}, household_id from task_routines where id=$1`, [id]);
        if (existing.rows[0] && existing.rows[0].household_id !== context.householdId) throw new Error("That routine is not available to this household.");
        if (!existing.rows[0]) await enforceLimit(database, "task_routines", context, 100);
        if (existing.rows[0]) {
          const previous = existing.rows[0];
          const unchanged = previous.text === routine.text && previous.childId === routine.childId
            && previous.frequency === routine.frequency && previous.interval === routine.interval
            && JSON.stringify(previous.weekdays) === JSON.stringify(routine.weekdays)
            && previous.startsOn === routine.startsOn && previous.endsOn === routine.endsOn && previous.active === routine.active;
          if (unchanged && !parsed.sourceItemId) break;
          if (!unchanged) await removeFutureRoutineItems(database, context, id, todayInTimeZone(membership.timezone), parsed.sourceItemId, { ...routine, id });
        }
        await database.query(`insert into task_routines(id,household_id,created_by,text,child_id,frequency,interval,weekdays,starts_on,ends_on,active)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10::date,$11) on conflict(id) do update set
          text=excluded.text,child_id=excluded.child_id,frequency=excluded.frequency,interval=excluded.interval,weekdays=excluded.weekdays,
          starts_on=excluded.starts_on,ends_on=excluded.ends_on,active=excluded.active where task_routines.household_id=excluded.household_id`,
          [id,context.householdId,context.userId,routine.text,routine.childId,routine.frequency,routine.interval,routine.weekdays,routine.startsOn,routine.endsOn,routine.active]);
        if (parsed.sourceItemId) {
          const source = await database.query<{ planning_date: string | null; week_start_date: string; routine_id: string | null; routine_occurrence_date: string | null }>(
            `select planning_date::text,week_start_date::text,routine_id,routine_occurrence_date::text from planning_items
             where id=$1 and household_id=$2 and type='task' for update`, [parsed.sourceItemId,context.householdId]);
          const item = source.rows[0];
          if (!item || (item.routine_id && item.routine_id !== id)) throw new Error("Choose a one-off task from this household to repeat.");
          // A retry may arrive after carryover moved the original task. Its
          // original occurrence identity remains authoritative.
          if (item.routine_id === id && item.routine_occurrence_date) break;
          const occurrence = routineOccurrencesForWeek({ ...routine,id },item.week_start_date).find((candidate) => candidate.planningDate === item.planning_date);
          if (!occurrence) throw new Error("The repeat rule must include this task's date. Adjust its start date and selected days.");
          const claimed = await database.query(`insert into task_routine_occurrences(routine_id,occurrence_date,item_id) values($1,$2::date,$3)
            on conflict(routine_id,occurrence_date) do update set item_id=excluded.item_id
            where task_routine_occurrences.item_id=excluded.item_id returning routine_id`, [id,occurrence.occurrenceDate,parsed.sourceItemId]);
          if (!claimed.rows[0]) throw new Error("That routine occurrence already exists. Choose the existing occurrence instead.");
          await database.query("update planning_items set routine_id=$3,routine_occurrence_date=$4::date,child_id=$5,text=$6 where id=$1 and household_id=$2", [parsed.sourceItemId,context.householdId,id,occurrence.occurrenceDate,routine.childId,routine.text]);
        }
        break;
      }
      case "deleteRoutine":
        await requireAvailable(database, "task_routines", context, parsed.id);
        await removeFutureRoutineItems(database, context, parsed.id, todayInTimeZone(membership.timezone));
        await database.query("delete from task_routines where id=$1 and household_id=$2", [parsed.id,context.householdId]);
        break;
      case "assignChild":
        await validateChildForHousehold(context.householdId, parsed.childId, database);
        if (!(await database.query("update planning_items set child_id=$3 where id=$1 and household_id=$2 returning id", [parsed.itemId,context.householdId,parsed.childId])).rows[0]) throw new Error("That task is not available to this household.");
        break;
      case "saveTemplate": {
        const id = parsed.id ?? randomUUID();
        const existing = await database.query<{ household_id: string }>("select household_id from week_templates where id=$1", [id]);
        if (existing.rows[0]) {
          if (existing.rows[0].household_id !== context.householdId) throw new Error("That template is not available to this household.");
          break;
        }
        await enforceLimit(database,"week_templates",context,30);
        const snapshot = await database.query<WeekTemplateItem>(`select (planning_date-week_start_date)::integer as "dayOffset",type,text,child_id as "childId"
          from planning_items where household_id=$1 and week_start_date=$2::date and routine_id is null order by sort_order,created_at limit 251`, [context.householdId,parsed.weekStart]);
        if (!snapshot.rows.length) throw new Error("Add one-off tasks or plans to this week before saving a template. Routines already repeat automatically.");
        if (snapshot.rows.length > 250) throw new Error("Templates can contain up to 250 tasks and plans.");
        await database.query("insert into week_templates(id,household_id,name,items) values($1,$2,$3,$4::jsonb)", [id,context.householdId,parsed.name,JSON.stringify(snapshot.rows)]);
        // The source week already contains this template's items.
        await database.query("insert into week_template_applications(template_id,week_start_date,applied_by) values($1,$2::date,$3)", [id,parsed.weekStart,context.userId]);
        break;
      }
      case "deleteTemplate":
        await requireAvailable(database,"week_templates",context,parsed.id);
        await database.query("delete from week_templates where id=$1 and household_id=$2", [parsed.id,context.householdId]);
        break;
      case "applyTemplate": {
        await requireAvailable(database,"week_templates",context,parsed.id);
        const application = await database.query(`insert into week_template_applications(template_id,week_start_date,applied_by)
          values($1,$2::date,$3) on conflict do nothing returning template_id`, [parsed.id,parsed.weekStart,context.userId]);
        if (!application.rows[0]) break;
        const template = await database.query<{ items: WeekTemplateItem[] }>("select items from week_templates where id=$1 and household_id=$2", [parsed.id,context.householdId]);
        for (const item of template.rows[0].items) {
          await validateChildForHousehold(context.householdId,item.childId,database);
          await database.query(`insert into planning_items(household_id,created_by,planning_date,week_start_date,type,text,child_id)
            values($1,$2,$3::date,$4::date,$5::planning_item_type,$6,$7)`, [context.householdId,context.userId,item.dayOffset===null?null:familyDateOffset(parsed.weekStart,item.dayOffset),parsed.weekStart,item.type,item.text,item.childId]);
        }
        break;
      }
      case "saveReview": {
        await database.query("insert into weekly_reviews(household_id,week_start_date) values($1,$2::date) on conflict do nothing", [context.householdId,parsed.weekStart]);
        const saved = await database.query(`update weekly_reviews set priorities=$3,meals=$4,logistics=$5,
          revision=revision+case when (priorities,meals,logistics) is distinct from ($3,$4,$5) then 1 else 0 end
          where household_id=$1 and week_start_date=$2::date and revision=$6 returning revision`,
          [context.householdId,parsed.weekStart,parsed.priorities,parsed.meals,parsed.logistics,parsed.revision]);
        if (!saved.rows[0]) throw new Error("Someone else updated this week's plan. Reload it before saving your changes.");
        break;
      }
      case "markReviewed": {
        await database.query("insert into weekly_reviews(household_id,week_start_date) values($1,$2::date) on conflict do nothing", [context.householdId,parsed.weekStart]);
        const review = await database.query<{ revision: number }>("select revision from weekly_reviews where household_id=$1 and week_start_date=$2::date", [context.householdId,parsed.weekStart]);
        const revision = review.rows[0].revision;
        if (parsed.reviewed && parsed.revision !== undefined && parsed.revision !== revision) throw new Error("The weekly plan changed. Reload it before marking it reviewed.");
        if (parsed.reviewed) await database.query(`insert into weekly_review_acknowledgements(household_id,week_start_date,user_id,revision)
          values($1,$2::date,$3,$4) on conflict(household_id,week_start_date,user_id) do update set revision=excluded.revision,reviewed_at=now()`, [context.householdId,parsed.weekStart,context.userId,revision]);
        else await database.query("delete from weekly_review_acknowledgements where household_id=$1 and week_start_date=$2::date and user_id=$3", [context.householdId,parsed.weekStart,context.userId]);
        break;
      }
    }
    await materialize(database, context, parsed.weekStart, membership.timezone);
  });
  return getFamilyPlanningData(context, parsed.weekStart);
}

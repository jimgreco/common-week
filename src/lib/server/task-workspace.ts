import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { requireHouseholdContext } from "@/lib/server/auth";
import { query, withTransaction } from "@/lib/server/database";
import { validateAssignedMembers } from "@/lib/server/household-assignments";
import { currentWeekStart, weekStartForDate } from "@/lib/date";
import {
  itemResourceSchema,
  workspaceMutationSchema,
  type ItemResource,
  type TaskRecord,
  type CollaborationEntry,
  type TaskWorkspaceData,
} from "@/lib/task-workspace";

type Context = Awaited<ReturnType<typeof requireHouseholdContext>>;
const columns = `id,text,type,responsible_member_id as "responsibleMemberId",deadline::text,is_backlog as "isBacklog",planning_date::text as "planningDate",week_start_date::text as "weekStartDate",is_completed as "isCompleted"`;
async function authorizeResource(
  context: Context,
  resource: ItemResource,
  db: Pick<PoolClient, "query">,
) {
  const found =
    "itemId" in resource
      ? await db.query(
          "select id from planning_items where id=$1 and household_id=$2 for update",
          [resource.itemId, context.householdId],
        )
      : await db.query(
          `select id from calendar_preferences where id=$1 and household_id=$2 and (visibility='share' or (visibility='private' and user_id=$3)) for update`,
          [resource.calendarId, context.householdId, context.userId],
        );
  if (!found.rows.length)
    throw new Error("This item is no longer available to you.");
}
async function collaborationId(
  context: Context,
  resource: ItemResource,
  db: Pick<PoolClient, "query">,
  create = false,
): Promise<string | null> {
  await authorizeResource(context, resource, db);
  const task = "itemId" in resource;
  if (create)
    await db.query(
      `insert into item_collaboration(household_id,planning_item_id,calendar_preference_id,provider_event_id) values($1,$2,$3,$4) on conflict do nothing`,
      [
        context.householdId,
        task ? resource.itemId : null,
        task ? null : resource.calendarId,
        task ? null : resource.eventId,
      ],
    );
  const found = await db.query<{ id: string }>(
    `select id from item_collaboration where household_id=$1 and ${task ? "planning_item_id=$2" : "calendar_preference_id=$2 and provider_event_id=$3"}`,
    task
      ? [context.householdId, resource.itemId]
      : [context.householdId, resource.calendarId, resource.eventId],
  );
  return found.rows[0]?.id ?? null;
}
export async function loadTaskWorkspace(
  rawResource?: unknown,
): Promise<TaskWorkspaceData> {
  const context = await requireHouseholdContext();
  if (!rawResource) {
    const tasks = await query<TaskRecord>(
      `select ${columns} from planning_items where household_id=$1 and type='task' order by is_completed,deadline nulls last,created_at desc`,
      [context.householdId],
    );
    return { tasks: tasks.rows, entries: [], task: null };
  }
  const resource = itemResourceSchema.parse(rawResource);
  return withTransaction(async (db) => {
    const id = await collaborationId(context, resource, db);
    const entries = id
      ? await db.query<CollaborationEntry>(
          `select e.id,e.kind,e.text,e.completed,e.created_by as "createdBy",coalesce(u.display_name,'Former member') as author,e.created_at as "createdAt" from item_collaboration_entries e left join users u on u.id=e.created_by where e.collaboration_id=$1 order by e.created_at,e.id`,
          [id],
        )
      : { rows: [] };
    const tasks =
      "itemId" in resource
        ? await db.query<TaskRecord>(
            `select ${columns} from planning_items where id=$1 and household_id=$2`,
            [resource.itemId, context.householdId],
          )
        : { rows: [] };
    return { tasks: [], entries: entries.rows, task: tasks.rows[0] ?? null };
  });
}
export async function mutateTaskWorkspace(raw: unknown) {
  const input = workspaceMutationSchema.parse(raw);
  const context = await requireHouseholdContext();
  if (context.role === "viewer")
    throw new Error("You do not have permission to change this household.");
  await withTransaction(async (db) => {
    if (input.action === "capture") {
      await db.query(
        `insert into planning_items(id,household_id,created_by,type,text,week_start_date,is_backlog) values($1,$2,$3,'task',$4,$5,true) on conflict(id) do nothing`,
        [
          input.id,
          context.householdId,
          context.userId,
          input.text,
          currentWeekStart(
            (
              await db.query<{ timezone: string }>(
                "select timezone from households where id=$1",
                [context.householdId],
              )
            ).rows[0].timezone,
          ),
        ],
      );
      return;
    }
    await authorizeResource(context, input.resource, db);
    if (input.action === "task") {
      const previous = (
        await db.query<TaskRecord>(
          `select ${columns} from planning_items where id=$1`,
          [input.resource.itemId],
        )
      ).rows[0];
      if (previous.type !== "task")
        throw new Error("Responsibilities and deadlines are for tasks.");
      if (
        input.claim &&
        previous.responsibleMemberId &&
        previous.responsibleMemberId !== context.userId
      )
        throw new Error(
          "This task has already been claimed. Refresh to see who is responsible.",
        );
      const responsible = input.claim
        ? context.userId
        : input.responsibleMemberId !== undefined
          ? input.responsibleMemberId
          : previous.responsibleMemberId;
      await validateAssignedMembers(
        context.householdId,
        responsible ? [responsible] : [],
        db,
      );
      const backlog = input.isBacklog ?? previous.isBacklog;
      const planningDate = backlog
        ? null
        : input.planningDate !== undefined
          ? input.planningDate
          : previous.planningDate;
      const week = planningDate
        ? weekStartForDate(planningDate)
        : (input.weekStartDate ?? previous.weekStartDate);
      if (weekStartForDate(week) !== week)
        throw new Error("Choose a week beginning Monday.");
      await db.query(
        `update planning_items set responsible_member_id=$2,deadline=$3,is_backlog=$4,planning_date=$5,week_start_date=$6,is_completed=$7,text=$8 where id=$1`,
        [
          previous.id,
          responsible,
          input.deadline !== undefined ? input.deadline : previous.deadline,
          backlog,
          planningDate,
          week,
          input.isCompleted ?? previous.isCompleted,
          input.text ?? previous.text,
        ],
      );
      if (
        responsible &&
        responsible !== previous.responsibleMemberId &&
        responsible !== context.userId
      ) {
        await db.query(
          `insert into notification_outbox(user_id,household_id,dedupe_key,kind,title,body,deep_link,scheduled_for)
          select hm.user_id,hm.household_id,$3,'household_change','A task is assigned to you',$4,$5,now() from household_members hm
          left join notification_preferences np on np.user_id=hm.user_id
          where hm.household_id=$1 and hm.user_id=$2 and coalesce(np.household_change_alerts,true)
          on conflict(dedupe_key) do nothing`,
          [
            context.householdId,
            responsible,
            `assignment:${randomUUID()}`,
            input.text ?? previous.text,
            `/planner?week=${week}&tasks=1&task=${previous.id}`,
          ],
        );
      }
      return;
    }
    const collaboration = await collaborationId(
      context,
      input.resource,
      db,
      true,
    );
    if (input.action === "add") {
      let file: Buffer | null = null;
      if (input.kind === "file") {
        if (!input.fileData || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.fileData))
          throw new Error("Choose a file to attach.");
        file = Buffer.from(input.fileData, "base64");
        if (!file.length || file.length > 5242880)
          throw new Error("Files must be between 1 byte and 5 MB.");
      }
      await db.query(
        `insert into item_collaboration_entries(id,household_id,collaboration_id,kind,text,created_by,file_data) values($1,$2,$3,$4,$5,$6,$7) on conflict(id) do nothing`,
        [
          input.id,
          context.householdId,
          collaboration,
          input.kind,
          input.text,
          context.userId,
          file,
        ],
      );
    } else if (input.action === "check") {
      await db.query(
        "update item_collaboration_entries set completed=$3 where id=$1 and collaboration_id=$2 and kind='checklist'",
        [input.id, collaboration, input.completed],
      );
    } else {
      const entry = (
        await db.query<{ kind: string; created_by: string }>(
          "select kind,created_by from item_collaboration_entries where id=$1 and collaboration_id=$2",
          [input.id, collaboration],
        )
      ).rows[0];
      if (
        entry &&
        entry.kind !== "checklist" &&
        entry.created_by !== context.userId &&
        context.role !== "owner"
      )
        throw new Error(
          "Only the author or household owner can remove this entry.",
        );
      await db.query(
        "delete from item_collaboration_entries where id=$1 and collaboration_id=$2",
        [input.id, collaboration],
      );
    }
  });
}
export async function downloadCollaborationFile(id: string) {
  const context = await requireHouseholdContext();
  return withTransaction(async (db) => {
    const entry = (
      await db.query<{
        text: string;
        file_data: Buffer;
        planning_item_id: string | null;
        calendar_preference_id: string;
        provider_event_id: string;
      }>(
        `select e.text,e.file_data,c.planning_item_id,c.calendar_preference_id,c.provider_event_id from item_collaboration_entries e join item_collaboration c on c.id=e.collaboration_id where e.id=$1 and e.household_id=$2 and e.kind='file'`,
        [id, context.householdId],
      )
    ).rows[0];
    if (!entry) throw new Error("File not found.");
    await authorizeResource(
      context,
      entry.planning_item_id
        ? { itemId: entry.planning_item_id }
        : {
            calendarId: entry.calendar_preference_id,
            eventId: entry.provider_event_id,
          },
      db,
    );
    return entry;
  });
}

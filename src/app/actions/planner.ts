"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { datesForLocationScope, isDateOnly, weekStartForDate } from "@/lib/date";
import { geocodingService } from "@/lib/integrations/geocoding";
import { requireHouseholdContext, requireUserContext } from "@/lib/server/auth";
import { postgresErrorCode, query, withTransaction } from "@/lib/server/database";
import { getPlannerData } from "@/lib/server/planner-data";
import { searchHouseholdCalendarEvents } from "@/lib/server/calendar-data";
import { queueHouseholdChange, upsertPlanningReminder } from "@/lib/server/notifications";
import type { ActionResult, GeocodingResult, HouseholdLocation, PlannerSearchResult, PlannerSourcePayload, PlanningItem, PlanningItemType } from "@/types/domain";

const uuid = z.string().uuid();
const itemText = z.string().trim().min(1).max(1000);
const dateOnly = z.string().refine(isDateOnly, "Invalid date.");

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

interface PlanningRow {
  id: string;
  planning_date: string | null;
  week_start_date: string;
  type: PlanningItemType;
  text: string;
  is_completed: boolean;
  sort_order: number;
  created_by: string;
  updated_at: Date;
}

function actionError<T = undefined>(error: unknown, fallback: string): ActionResult<T> {
  if (error instanceof z.ZodError || postgresErrorCode(error)) return { ok: false, error: fallback };
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

function mappedItem(row: PlanningRow): PlanningItem {
  return {
    id: row.id,
    planningDate: row.planning_date,
    weekStartDate: row.week_start_date,
    type: row.type,
    text: row.text,
    isCompleted: row.is_completed,
    sortOrder: row.sort_order,
    createdBy: row.created_by,
    updatedAt: row.updated_at.toISOString(),
    saveState: "saved",
  };
}

function validateWeek(planningDate: string | null, weekStartDate: string) {
  if (weekStartForDate(weekStartDate) !== weekStartDate) throw new Error("Week must begin Monday.");
  if (planningDate && weekStartForDate(planningDate) !== weekStartDate) {
    throw new Error("Planning date must be in the selected week.");
  }
}

export async function loadPlannerSourcesAction(weekStartDate: string): Promise<ActionResult<PlannerSourcePayload>> {
  try {
    const weekStart = dateOnly.parse(weekStartDate);
    validateWeek(null, weekStart);
    const context = await requireHouseholdContext();
    const data = await getPlannerData(context, weekStart, { includeExternal: true });
    return {
      ok: true,
      data: {
        days: data.days.map(({ date, events, weather }) => ({ date, events, weather })),
        calendarState: data.calendarState,
        weatherState: data.weatherState,
      },
    };
  } catch {
    return { ok: false, error: "Calendar and weather could not be refreshed." };
  }
}

export async function hideCalendarEventAction(input: {
  eventId: string;
  title: string;
  calendarName: string;
  eventStart: string;
}): Promise<ActionResult> {
  try {
    const parsed = z.object({
      eventId: z.string().trim().min(1).max(2048),
      title: z.string().trim().min(1).max(2048),
      calendarName: z.string().trim().min(1).max(1000),
      eventStart: z.string().trim().min(1).max(100),
    }).parse(input);
    const context = await requireHouseholdContext();
    await query(
      `insert into hidden_calendar_events (
         household_id, event_id, title, calendar_name, event_start, hidden_by
       ) values ($1, $2, $3, $4, $5, $6)
       on conflict (household_id, event_id) do update set
         title = excluded.title,
         calendar_name = excluded.calendar_name,
         event_start = excluded.event_start,
         hidden_by = excluded.hidden_by,
         hidden_at = now()`,
      [
        context.householdId,
        parsed.eventId,
        parsed.title,
        parsed.calendarName,
        parsed.eventStart,
        context.userId,
      ],
    );
    revalidatePath("/planner");
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    return actionError(error, "The event could not be hidden.");
  }
}

export async function createPlanningItemAction(input: {
  id?: string;
  text: string;
  type: PlanningItemType;
  planningDate: string | null;
  weekStartDate: string;
  remindAt?: string | null;
}): Promise<ActionResult<PlanningItem>> {
  try {
    const parsed = z.object({
      id: uuid.optional(),
      text: itemText,
      type: z.enum(["note", "task"]),
      planningDate: dateOnly.nullable(),
      weekStartDate: dateOnly,
      remindAt: z.string().datetime().nullable().optional(),
    }).parse(input);
    validateWeek(parsed.planningDate, parsed.weekStartDate);
    const context = await requireHouseholdContext();
    const saved = await withTransaction(async (database) => {
      const inserted = await database.query<PlanningRow>(
        `insert into planning_items (
           id, household_id, created_by, planning_date, week_start_date, type, text
         )
         values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4::date, $5::date, $6::planning_item_type, $7)
         on conflict (id) do nothing
         returning id, planning_date::text, week_start_date::text, type,
                   text, is_completed, sort_order, created_by, updated_at`,
        [
          parsed.id ?? null,
          context.householdId,
          context.userId,
          parsed.planningDate,
          parsed.weekStartDate,
          parsed.type,
          parsed.text,
        ],
      );
      if (inserted.rows[0]) return { result: inserted, inserted: true };
      return { result: await database.query<PlanningRow>(
        `select id, planning_date::text, week_start_date::text, type,
                text, is_completed, sort_order, created_by, updated_at
           from planning_items
          where id = $1 and household_id = $2 and created_by = $3`,
        [parsed.id, context.householdId, context.userId],
      ), inserted: false };
    });
    const row = saved.result.rows[0];
    if (!row) throw new Error("That offline change is not available to this household.");
    const reminder = parsed.remindAt !== undefined
      ? await upsertPlanningReminder({
        userId: context.userId,
        householdId: context.householdId,
        itemId: row.id,
        title: row.text,
        remindAt: parsed.remindAt ? new Date(parsed.remindAt) : null,
      })
      : null;
    if (saved.inserted) {
      await queueHouseholdChange({
        actorUserId: context.userId,
        householdId: context.householdId,
        title: `${context.displayName} added ${parsed.type === "task" ? "a task" : "a plan"}`,
        body: parsed.text,
      });
    }
    revalidatePath("/planner");
    return { ok: true, data: { ...mappedItem(row), reminder } };
  } catch (error) {
    return actionError(error, "Your item could not be saved.");
  }
}

export async function updatePlanningItemAction(input: {
  id: string;
  text: string;
  type: PlanningItemType;
  planningDate: string | null;
  weekStartDate: string;
  remindAt?: string | null;
}): Promise<ActionResult> {
  try {
    const parsed = z.object({
      id: uuid,
      text: itemText,
      type: z.enum(["note", "task"]),
      planningDate: dateOnly.nullable(),
      weekStartDate: dateOnly,
      remindAt: z.string().datetime().nullable().optional(),
    }).parse(input);
    validateWeek(parsed.planningDate, parsed.weekStartDate);
    const context = await requireHouseholdContext();
    const result = await query(
      `update planning_items set
         text = $3, type = $4::planning_item_type, planning_date = $5::date,
         week_start_date = $6::date
       where id = $1 and household_id = $2`,
      [
        parsed.id,
        context.householdId,
        parsed.text,
        parsed.type,
        parsed.planningDate,
        parsed.weekStartDate,
      ],
    );
    if (!result.rowCount) throw new Error("That item is not available to this household.");
    if (parsed.remindAt !== undefined) {
      await upsertPlanningReminder({
        userId: context.userId,
        householdId: context.householdId,
        itemId: parsed.id,
        title: parsed.text,
        remindAt: parsed.remindAt ? new Date(parsed.remindAt) : null,
      });
    }
    await queueHouseholdChange({
      actorUserId: context.userId,
      householdId: context.householdId,
      title: `${context.displayName} updated ${parsed.type === "task" ? "a task" : "a plan"}`,
      body: parsed.text,
    });
    revalidatePath("/planner");
    return { ok: true };
  } catch (error) {
    return actionError(error, "Your changes could not be saved.");
  }
}

export async function togglePlanningItemAction(id: string, completed: boolean): Promise<ActionResult> {
  try {
    const parsedId = uuid.parse(id);
    const context = await requireHouseholdContext();
    const result = await query(
      "update planning_items set is_completed = $3 where id = $1 and household_id = $2",
      [parsedId, context.householdId, Boolean(completed)],
    );
    if (!result.rowCount) throw new Error("That task is not available to this household.");
    await queueHouseholdChange({
      actorUserId: context.userId,
      householdId: context.householdId,
      title: `${context.displayName} ${completed ? "completed" : "reopened"} a task`,
      body: "Open Week of Us to see the shared week.",
    });
    revalidatePath("/planner");
    return { ok: true };
  } catch (error) {
    return actionError(error, "Task status could not be saved.");
  }
}

export async function deletePlanningItemAction(id: string): Promise<ActionResult> {
  try {
    const parsedId = uuid.parse(id);
    const context = await requireHouseholdContext();
    const deleted = await query<{ text: string; type: PlanningItemType }>(
      "delete from planning_items where id = $1 and household_id = $2 returning text, type",
      [parsedId, context.householdId],
    );
    // Deletion is intentionally idempotent so a native client can safely replay
    // a request when it did not receive the original response.
    if (deleted.rows[0]) {
      await queueHouseholdChange({
        actorUserId: context.userId,
        householdId: context.householdId,
        title: `${context.displayName} removed ${deleted.rows[0].type === "task" ? "a task" : "a plan"}`,
        body: deleted.rows[0].text,
      });
    }
    revalidatePath("/planner");
    return { ok: true };
  } catch (error) {
    return actionError(error, "The item could not be deleted.");
  }
}

export async function setDailyLocationAction(input: {
  startDate: string;
  locationId: string;
  scope: "day" | "through-sunday" | "week";
}): Promise<ActionResult> {
  try {
    const parsed = z.object({
      startDate: dateOnly,
      locationId: uuid,
      scope: z.enum(["day", "through-sunday", "week"]),
    }).parse(input);
    const context = await requireHouseholdContext();
    const location = await query(
      "select 1 from locations where id = $1 and household_id = $2",
      [parsed.locationId, context.householdId],
    );
    if (!location.rowCount) throw new Error("That location is not available to this household.");

    await query(
      `insert into daily_settings (household_id, date, location_id)
       select $1, assigned_date, $3
         from unnest($2::date[]) as assigned_date
       on conflict (household_id, date) do update set location_id = excluded.location_id`,
      [context.householdId, datesForLocationScope(parsed.startDate, parsed.scope), parsed.locationId],
    );
    revalidatePath("/planner");
    return { ok: true };
  } catch (error) {
    return actionError(error, "Location changes could not be saved.");
  }
}

export async function setGeocodedLocationAction(input: {
  startDate: string;
  scope: "day" | "through-sunday" | "week";
  saveForReuse?: boolean;
  location: {
    name: string;
    latitude: number;
    longitude: number;
    timezone: string;
  };
}): Promise<ActionResult<HouseholdLocation>> {
  try {
    const parsed = z.object({
      startDate: dateOnly,
      scope: z.enum(["day", "through-sunday", "week"]),
      saveForReuse: z.boolean().default(true),
      location: z.object({
        name: z.string().trim().min(1).max(120),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        timezone: z.string().refine(validTimeZone, "Choose a valid timezone."),
      }),
    }).parse(input);
    const context = await requireHouseholdContext();
    const location = await withTransaction(async (database) => {
      const locationResult = await database.query<{
        id: string;
        name: string;
        latitude: number;
        longitude: number;
        timezone: string;
        is_saved: boolean;
      }>(
        `insert into locations (household_id, name, latitude, longitude, timezone, is_saved)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (household_id, name) do update set
           latitude = excluded.latitude,
           longitude = excluded.longitude,
           timezone = excluded.timezone,
           is_saved = locations.is_saved or excluded.is_saved
         returning id, name, latitude, longitude, timezone, is_saved`,
        [
          context.householdId,
          parsed.location.name,
          parsed.location.latitude,
          parsed.location.longitude,
          parsed.location.timezone,
          parsed.saveForReuse,
        ],
      );
      const savedLocation = locationResult.rows[0];
      if (!savedLocation) throw new Error("The location could not be set.");

      await database.query(
        `insert into daily_settings (household_id, date, location_id)
         select $1, assigned_date, $3
           from unnest($2::date[]) as assigned_date
         on conflict (household_id, date) do update set location_id = excluded.location_id`,
        [
          context.householdId,
          datesForLocationScope(parsed.startDate, parsed.scope),
          savedLocation.id,
        ],
      );

      return {
        id: savedLocation.id,
        name: savedLocation.name,
        latitude: savedLocation.latitude,
        longitude: savedLocation.longitude,
        timezone: savedLocation.timezone,
        isSaved: savedLocation.is_saved,
      } satisfies HouseholdLocation;
    });
    revalidatePath("/settings");
    revalidatePath("/planner");
    return { ok: true, data: location };
  } catch (error) {
    return actionError<HouseholdLocation>(error, "The location could not be set.");
  }
}

export async function searchLocationsAction(search: string): Promise<ActionResult<GeocodingResult[]>> {
  try {
    await requireUserContext();
    const parsed = z.string().trim().min(2).max(120).parse(search);
    return { ok: true, data: await geocodingService.search(parsed) };
  } catch (error) {
    return actionError<GeocodingResult[]>(error, "Location search failed.");
  }
}

export async function searchPlanningItemsAction(search: string): Promise<ActionResult<PlanningItem[]>> {
  try {
    const parsed = z.string().trim().min(2).max(100).parse(search);
    const context = await requireHouseholdContext();
    const escaped = parsed.replace(/[\\%_]/g, "\\$&");
    const result = await query<PlanningRow>(
      `select id, planning_date::text, week_start_date::text, type,
              text, is_completed, sort_order, created_by, updated_at
         from planning_items
        where household_id = $1 and text ilike $2 escape '\\'
        order by updated_at desc limit 30`,
      [context.householdId, `%${escaped}%`],
    );
    return { ok: true, data: result.rows.map(mappedItem) };
  } catch (error) {
    return actionError<PlanningItem[]>(error, "Search is temporarily unavailable.");
  }
}

export async function searchPlannerAction(search: string): Promise<ActionResult<PlannerSearchResult[]>> {
  try {
    const parsed = z.string().trim().min(2).max(100).parse(search);
    const context = await requireHouseholdContext();
    const escaped = parsed.replace(/[\\%_]/g, "\\$&");
    const [planning, events] = await Promise.all([
      query<PlanningRow & { reminder_id: string | null; remind_at: Date | null }>(
        `select pi.id, pi.planning_date::text, pi.week_start_date::text, pi.type,
                pi.text, pi.is_completed, pi.sort_order, pi.created_by, pi.updated_at,
                nr.id as reminder_id, nr.remind_at
           from planning_items pi
           left join notification_reminders nr
             on nr.planning_item_id = pi.id and nr.user_id = $3 and nr.delivered_at is null
          where pi.household_id = $1 and pi.text ilike $2 escape '\\'
          order by pi.updated_at desc limit 30`,
        [context.householdId, `%${escaped}%`, context.userId],
      ),
      searchHouseholdCalendarEvents(context, parsed),
    ]);
    return {
      ok: true,
      data: [
        ...events.map((event) => ({ kind: "calendar_event" as const, event })),
        ...planning.rows.map((row) => ({
          kind: "planning_item" as const,
          item: {
            ...mappedItem(row),
            reminder: row.reminder_id && row.remind_at
              ? { id: row.reminder_id, resourceKind: "planning_item" as const, remindAt: row.remind_at.toISOString() }
              : null,
          },
        })),
      ],
    };
  } catch (error) {
    return actionError<PlannerSearchResult[]>(error, "Search is temporarily unavailable.");
  }
}

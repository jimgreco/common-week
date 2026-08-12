"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { datesForLocationScope, isDateOnly, weekStartForDate } from "@/lib/date";
import { geocodingService } from "@/lib/integrations/geocoding";
import { requireHouseholdContext, requireUserContext } from "@/lib/server/auth";
import { postgresErrorCode, query } from "@/lib/server/database";
import { getPlannerData } from "@/lib/server/planner-data";
import type { ActionResult, GeocodingResult, PlannerSourcePayload, PlanningItem, PlanningItemType } from "@/types/domain";

const uuid = z.string().uuid();
const itemText = z.string().trim().min(1).max(1000);
const dateOnly = z.string().refine(isDateOnly, "Invalid date.");

interface PlanningRow {
  id: string;
  planning_date: string | null;
  week_start_date: string;
  type: PlanningItemType;
  category_id: string | null;
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
    categoryId: row.category_id,
    categoryName: null,
    categoryColor: null,
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

export async function createPlanningItemAction(input: {
  text: string;
  type: PlanningItemType;
  planningDate: string | null;
  weekStartDate: string;
  categoryId: string | null;
}): Promise<ActionResult<PlanningItem>> {
  try {
    const parsed = z.object({
      text: itemText,
      type: z.enum(["note", "task"]),
      planningDate: dateOnly.nullable(),
      weekStartDate: dateOnly,
      categoryId: uuid.nullable(),
    }).parse(input);
    validateWeek(parsed.planningDate, parsed.weekStartDate);
    const context = await requireHouseholdContext();
    const result = await query<PlanningRow>(
      `insert into planning_items (
         household_id, created_by, planning_date, week_start_date, type, category_id, text
       )
       select $1, $2, $3::date, $4::date, $5::planning_item_type, $6::uuid, $7
       where $6::uuid is null or exists (
         select 1 from categories where id = $6 and (household_id is null or household_id = $1)
       )
       returning id, planning_date::text, week_start_date::text, type, category_id,
                 text, is_completed, sort_order, created_by, updated_at`,
      [
        context.householdId,
        context.userId,
        parsed.planningDate,
        parsed.weekStartDate,
        parsed.type,
        parsed.categoryId,
        parsed.text,
      ],
    );
    if (!result.rows[0]) throw new Error("That category is not available to this household.");
    revalidatePath("/planner");
    return { ok: true, data: mappedItem(result.rows[0]) };
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
  categoryId: string | null;
}): Promise<ActionResult> {
  try {
    const parsed = z.object({
      id: uuid,
      text: itemText,
      type: z.enum(["note", "task"]),
      planningDate: dateOnly.nullable(),
      weekStartDate: dateOnly,
      categoryId: uuid.nullable(),
    }).parse(input);
    validateWeek(parsed.planningDate, parsed.weekStartDate);
    const context = await requireHouseholdContext();
    const result = await query(
      `update planning_items set
         text = $3, type = $4::planning_item_type, planning_date = $5::date,
         week_start_date = $6::date, category_id = $7::uuid
       where id = $1 and household_id = $2
         and ($7::uuid is null or exists (
           select 1 from categories where id = $7 and (household_id is null or household_id = $2)
         ))`,
      [
        parsed.id,
        context.householdId,
        parsed.text,
        parsed.type,
        parsed.planningDate,
        parsed.weekStartDate,
        parsed.categoryId,
      ],
    );
    if (!result.rowCount) throw new Error("That item is not available to this household.");
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
    const result = await query(
      "delete from planning_items where id = $1 and household_id = $2",
      [parsedId, context.householdId],
    );
    if (!result.rowCount) throw new Error("That item is not available to this household.");
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
      `select id, planning_date::text, week_start_date::text, type, category_id,
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

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { datesForLocationScope, isDateOnly, weekStartForDate } from "@/lib/date";
import { geocodingService } from "@/lib/integrations/geocoding";
import { requireHouseholdContext, requireUserContext } from "@/lib/server/auth";
import { getPlannerData } from "@/lib/server/planner-data";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult, GeocodingResult, PlannerSourcePayload, PlanningItem, PlanningItemType } from "@/types/domain";

const uuid = z.string().uuid();
const itemText = z.string().trim().min(1).max(1000);
const dateOnly = z.string().refine(isDateOnly, "Invalid date.");

function actionError<T = undefined>(error: unknown, fallback: string): ActionResult<T> {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

function mappedItem(row: Record<string, unknown>): PlanningItem {
  return {
    id: String(row.id),
    planningDate: row.planning_date ? String(row.planning_date) : null,
    weekStartDate: String(row.week_start_date),
    type: row.type as PlanningItemType,
    categoryId: row.category_id ? String(row.category_id) : null,
    categoryName: null,
    categoryColor: null,
    text: String(row.text),
    isCompleted: Boolean(row.is_completed),
    sortOrder: Number(row.sort_order),
    createdBy: String(row.created_by),
    updatedAt: String(row.updated_at),
    saveState: "saved",
  };
}

export async function loadPlannerSourcesAction(weekStartDate: string): Promise<ActionResult<PlannerSourcePayload>> {
  try {
    const weekStart = dateOnly.parse(weekStartDate);
    if (weekStartForDate(weekStart) !== weekStart) throw new Error("Week must begin Monday.");
    const context = await requireHouseholdContext();
    const data = await getPlannerData(
      { userId: context.userId, householdId: context.householdId },
      weekStart,
      { includeExternal: true },
    );
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
    const parsed = z
      .object({
        text: itemText,
        type: z.enum(["note", "task"]),
        planningDate: dateOnly.nullable(),
        weekStartDate: dateOnly,
        categoryId: uuid.nullable(),
      })
      .parse(input);
    if (weekStartForDate(parsed.weekStartDate) !== parsed.weekStartDate) throw new Error("Week must begin Monday.");
    if (parsed.planningDate && weekStartForDate(parsed.planningDate) !== parsed.weekStartDate) {
      throw new Error("Planning date must be in the selected week.");
    }
    const context = await requireHouseholdContext();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("planning_items")
      .insert({
        household_id: context.householdId,
        created_by: context.userId,
        planning_date: parsed.planningDate,
        week_start_date: parsed.weekStartDate,
        type: parsed.type,
        category_id: parsed.categoryId,
        text: parsed.text,
      })
      .select("id, planning_date, week_start_date, type, category_id, text, is_completed, sort_order, created_by, updated_at")
      .single();
    if (error || !data) throw new Error("Your item could not be saved.");
    revalidatePath("/planner");
    return { ok: true, data: mappedItem(data) };
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
    const parsed = z
      .object({
        id: uuid,
        text: itemText,
        type: z.enum(["note", "task"]),
        planningDate: dateOnly.nullable(),
        weekStartDate: dateOnly,
        categoryId: uuid.nullable(),
      })
      .parse(input);
    if (weekStartForDate(parsed.weekStartDate) !== parsed.weekStartDate) throw new Error("Week must begin Monday.");
    if (parsed.planningDate && weekStartForDate(parsed.planningDate) !== parsed.weekStartDate) {
      throw new Error("Planning date must be in the selected week.");
    }
    await requireHouseholdContext();
    const supabase = await createClient();
    const { error } = await supabase
      .from("planning_items")
      .update({
        text: parsed.text,
        type: parsed.type,
        planning_date: parsed.planningDate,
        week_start_date: parsed.weekStartDate,
        category_id: parsed.categoryId,
      })
      .eq("id", parsed.id);
    if (error) throw new Error("Your changes could not be saved.");
    revalidatePath("/planner");
    return { ok: true };
  } catch (error) {
    return actionError(error, "Your changes could not be saved.");
  }
}

export async function togglePlanningItemAction(id: string, completed: boolean): Promise<ActionResult> {
  try {
    const parsedId = uuid.parse(id);
    await requireHouseholdContext();
    const supabase = await createClient();
    const { error } = await supabase
      .from("planning_items")
      .update({ is_completed: Boolean(completed) })
      .eq("id", parsedId);
    if (error) throw new Error("Task status could not be saved.");
    revalidatePath("/planner");
    return { ok: true };
  } catch (error) {
    return actionError(error, "Task status could not be saved.");
  }
}

export async function deletePlanningItemAction(id: string): Promise<ActionResult> {
  try {
    const parsedId = uuid.parse(id);
    await requireHouseholdContext();
    const supabase = await createClient();
    const { error } = await supabase.from("planning_items").delete().eq("id", parsedId);
    if (error) throw new Error("The item could not be deleted.");
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
    const parsed = z
      .object({ startDate: dateOnly, locationId: uuid, scope: z.enum(["day", "through-sunday", "week"]) })
      .parse(input);
    const context = await requireHouseholdContext();
    const supabase = await createClient();
    const { data: location } = await supabase
      .from("locations")
      .select("id")
      .eq("id", parsed.locationId)
      .eq("household_id", context.householdId)
      .maybeSingle();
    if (!location) throw new Error("That location is not available to this household.");

    const rows = datesForLocationScope(parsed.startDate, parsed.scope).map((date) => ({
      household_id: context.householdId,
      date,
      location_id: parsed.locationId,
    }));
    const { error } = await supabase.from("daily_settings").upsert(rows, { onConflict: "household_id,date" });
    if (error) throw new Error("Location changes could not be saved.");
    revalidatePath("/planner");
    return { ok: true };
  } catch (error) {
    return actionError(error, "Location changes could not be saved.");
  }
}

export async function searchLocationsAction(query: string): Promise<ActionResult<GeocodingResult[]>> {
  try {
    await requireUserContext();
    const parsed = z.string().trim().min(2).max(120).parse(query);
    return { ok: true, data: await geocodingService.search(parsed) };
  } catch (error) {
    return actionError<GeocodingResult[]>(error, "Location search failed.");
  }
}

export async function searchPlanningItemsAction(query: string): Promise<ActionResult<PlanningItem[]>> {
  try {
    const parsed = z.string().trim().min(2).max(100).parse(query);
    await requireHouseholdContext();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("planning_items")
      .select("id, planning_date, week_start_date, type, category_id, text, is_completed, sort_order, created_by, updated_at")
      .ilike("text", `%${parsed.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`)
      .order("updated_at", { ascending: false })
      .limit(30);
    if (error) throw new Error("Search is temporarily unavailable.");
    return { ok: true, data: (data ?? []).map((row) => mappedItem(row)) };
  } catch (error) {
    return actionError<PlanningItem[]>(error, "Search is temporarily unavailable.");
  }
}

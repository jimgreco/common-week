import "server-only";

import { eventFallsOnDate, markCalendarConflicts } from "@/lib/calendar-utils";
import { weekDates } from "@/lib/date";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdCalendarEvents } from "@/lib/server/calendar-data";
import { getWeatherForAssignments } from "@/lib/server/weather-data";
import type {
  HouseholdLocation,
  HouseholdMember,
  PlanningCategory,
  PlanningItem,
  PlannerSourceState,
  WeeklyPlannerData,
} from "@/types/domain";

interface PlannerContext {
  userId: string;
  householdId: string;
}

function mapLocation(row: Record<string, unknown>, defaultLocationId: string | null): HouseholdLocation {
  return {
    id: String(row.id),
    name: String(row.name),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    timezone: String(row.timezone),
    isSaved: Boolean(row.is_saved),
    isDefault: row.id === defaultLocationId,
  };
}

function mapPlanningItem(
  row: Record<string, unknown>,
  profileNames: Map<string, string>,
): PlanningItem {
  const joinedCategory = row.categories as { name?: string; color?: string } | null;
  return {
    id: String(row.id),
    planningDate: row.planning_date ? String(row.planning_date) : null,
    weekStartDate: String(row.week_start_date),
    type: row.type as "note" | "task",
    categoryId: row.category_id ? String(row.category_id) : null,
    categoryName: joinedCategory?.name ?? null,
    categoryColor: joinedCategory?.color ?? null,
    text: String(row.text),
    isCompleted: Boolean(row.is_completed),
    sortOrder: Number(row.sort_order),
    createdBy: String(row.created_by),
    createdByName: profileNames.get(String(row.created_by)),
    updatedAt: String(row.updated_at),
    saveState: "saved",
  };
}

export async function getPlannerData(
  context: PlannerContext,
  weekStart: string,
  options: { includeExternal?: boolean } = {},
): Promise<WeeklyPlannerData> {
  const supabase = await createClient();
  const dates = weekDates(weekStart);

  const [householdResult, locationsResult, settingsResult, planningResult, categoriesResult, membersResult] =
    await Promise.all([
      supabase
        .from("households")
        .select("id, name, timezone, temperature_unit, default_location_id")
        .eq("id", context.householdId)
        .single(),
      supabase
        .from("locations")
        .select("id, name, latitude, longitude, timezone, is_saved")
        .eq("household_id", context.householdId)
        .order("name"),
      supabase
        .from("daily_settings")
        .select("date, location_id")
        .eq("household_id", context.householdId)
        .gte("date", dates[0])
        .lte("date", dates[6]),
      supabase
        .from("planning_items")
        .select(
          "id, planning_date, week_start_date, type, category_id, text, is_completed, sort_order, created_by, updated_at, categories(name, color)",
        )
        .eq("household_id", context.householdId)
        .eq("week_start_date", weekStart)
        .order("sort_order")
        .order("created_at"),
      supabase
        .from("categories")
        .select("id, name, color, sort_order")
        .or(`household_id.is.null,household_id.eq.${context.householdId}`)
        .order("sort_order"),
      supabase
        .from("household_members")
        .select("id, user_id, role, created_at")
        .eq("household_id", context.householdId)
        .order("created_at"),
    ]);

  if (householdResult.error || !householdResult.data) {
    throw new Error("The household planner could not be loaded.");
  }

  const memberRows = (membersResult.data ?? []) as Array<Record<string, unknown>>;
  const userIds = memberRows.map((row) => String(row.user_id));
  const { data: profileRows } = userIds.length
    ? await supabase.from("profiles").select("id, display_name, email").in("id", userIds)
    : { data: [] };
  const profiles = new Map(
    ((profileRows ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id),
      { displayName: String(row.display_name), email: String(row.email) },
    ]),
  );
  const profileNames = new Map([...profiles.entries()].map(([id, profile]) => [id, profile.displayName]));

  const household = householdResult.data;
  const locations = ((locationsResult.data ?? []) as Array<Record<string, unknown>>).map((row) =>
    mapLocation(row, household.default_location_id),
  );
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const defaultLocation = household.default_location_id
    ? locationById.get(household.default_location_id) ?? null
    : null;
  const overrides = new Map(
    ((settingsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.date),
      String(row.location_id),
    ]),
  );
  const assignments = dates.map((date) => ({
    date,
    location: locationById.get(overrides.get(date) ?? "") ?? defaultLocation,
  }));

  const members: HouseholdMember[] = memberRows.map((row) => {
    const profile = profiles.get(String(row.user_id));
    return {
      id: String(row.id),
      userId: String(row.user_id),
      displayName: profile?.displayName ?? "Family member",
      email: profile?.email ?? "",
      role: row.role as "owner" | "member" | "viewer",
    };
  });

  const loadingState: PlannerSourceState = { status: "loading" };
  const [calendarBundle, weatherBundle] = options.includeExternal === false
    ? [{ events: [], state: loadingState }, { forecasts: new Map(), state: loadingState }]
    : await Promise.all([
      getHouseholdCalendarEvents(
        context.householdId,
        members.map((member) => ({ userId: member.userId, displayName: member.displayName })),
        weekStart,
        household.timezone,
      ),
      getWeatherForAssignments(assignments),
    ]);

  const items = ((planningResult.data ?? []) as Array<Record<string, unknown>>).map((row) =>
    mapPlanningItem(row, profileNames),
  );
  const categories: PlanningCategory[] = ((categoriesResult.data ?? []) as Array<Record<string, unknown>>).map(
    (row) => ({ id: String(row.id), name: String(row.name), color: String(row.color) }),
  );

  return {
    household: {
      id: household.id,
      name: household.name,
      timezone: household.timezone,
      temperatureUnit: household.temperature_unit,
    },
    members,
    weekStart,
    days: assignments.map(({ date, location }) => ({
      date,
      location,
      weather: location ? weatherBundle.forecasts.get(`${location.id}:${date}`) ?? null : null,
      events: markCalendarConflicts(
        calendarBundle.events.filter((event) => eventFallsOnDate(event, date, household.timezone)),
      ),
      items: items.filter((item) => item.planningDate === date),
    })),
    weeklyItems: items.filter((item) => item.planningDate === null),
    locations,
    categories,
    calendarState: calendarBundle.state,
    weatherState: weatherBundle.state,
    isDemo: false,
  };
}

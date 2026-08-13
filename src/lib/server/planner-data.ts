import "server-only";

import { eventFallsOnDate, markCalendarConflicts, sortCalendarEvents } from "@/lib/calendar-utils";
import { weekDates } from "@/lib/date";
import { query } from "@/lib/server/database";
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

interface HouseholdRow {
  id: string;
  name: string;
  timezone: string;
  temperature_unit: "fahrenheit" | "celsius";
  default_location_id: string | null;
}

interface LocationRow {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  is_saved: boolean;
}

interface PlanningRow {
  id: string;
  planning_date: string | null;
  week_start_date: string;
  type: "note" | "task";
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
  text: string;
  is_completed: boolean;
  sort_order: number;
  created_by: string;
  created_by_name: string;
  updated_at: Date;
}

function mapLocation(row: LocationRow, defaultLocationId: string | null): HouseholdLocation {
  return {
    id: row.id,
    name: row.name,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    timezone: row.timezone,
    isSaved: row.is_saved,
    isDefault: row.id === defaultLocationId,
  };
}

function mapPlanningItem(row: PlanningRow): PlanningItem {
  return {
    id: row.id,
    planningDate: row.planning_date,
    weekStartDate: row.week_start_date,
    type: row.type,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryColor: row.category_color,
    text: row.text,
    isCompleted: row.is_completed,
    sortOrder: row.sort_order,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    updatedAt: row.updated_at.toISOString(),
    saveState: "saved",
  };
}

export async function getPlannerData(
  context: PlannerContext,
  weekStart: string,
  options: { includeExternal?: boolean } = {},
): Promise<WeeklyPlannerData> {
  const dates = weekDates(weekStart);
  const [householdResult, locationsResult, settingsResult, planningResult, categoriesResult, membersResult, hiddenEventsResult] =
    await Promise.all([
      query<HouseholdRow>(
        `select h.id, h.name, h.timezone, h.temperature_unit, h.default_location_id
           from households h
           join household_members hm on hm.household_id = h.id
          where h.id = $1 and hm.user_id = $2`,
        [context.householdId, context.userId],
      ),
      query<LocationRow>(
        `select id, name, latitude, longitude, timezone, is_saved
           from locations where household_id = $1 order by name`,
        [context.householdId],
      ),
      query<{ date: string; location_id: string }>(
        `select date::text, location_id from daily_settings
          where household_id = $1 and date between $2::date and $3::date`,
        [context.householdId, dates[0], dates[6]],
      ),
      query<PlanningRow>(
        `select pi.id, pi.planning_date::text, pi.week_start_date::text, pi.type,
                pi.category_id, c.name as category_name, c.color as category_color,
                pi.text, pi.is_completed, pi.sort_order, pi.created_by,
                u.display_name as created_by_name, pi.updated_at
           from planning_items pi
           join users u on u.id = pi.created_by
           left join categories c on c.id = pi.category_id
          where pi.household_id = $1 and pi.week_start_date = $2::date
          order by pi.sort_order, pi.created_at`,
        [context.householdId, weekStart],
      ),
      query<{ id: string; name: string; color: string }>(
        `select id, name, color from categories
          where household_id is null or household_id = $1
          order by sort_order`,
        [context.householdId],
      ),
      query<{
        id: string;
        user_id: string;
        role: "owner" | "member" | "viewer";
        display_name: string;
        email: string;
      }>(
        `select hm.id, hm.user_id, hm.role, u.display_name, u.email::text
           from household_members hm
           join users u on u.id = hm.user_id
          where hm.household_id = $1
          order by hm.created_at`,
        [context.householdId],
      ),
      query<{ event_id: string }>(
        "select event_id from hidden_calendar_events where household_id = $1",
        [context.householdId],
      ),
    ]);

  const household = householdResult.rows[0];
  if (!household) throw new Error("The household planner could not be loaded.");

  const locations = locationsResult.rows.map((row) => mapLocation(row, household.default_location_id));
  const locationById = new Map(locations.map((location) => [location.id, location]));
  const defaultLocation = household.default_location_id
    ? locationById.get(household.default_location_id) ?? null
    : null;
  const overrides = new Map(settingsResult.rows.map((row) => [row.date, row.location_id]));
  const assignments = dates.map((date) => ({
    date,
    location: locationById.get(overrides.get(date) ?? "") ?? defaultLocation,
  }));

  const members: HouseholdMember[] = membersResult.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
  }));
  const loadingState: PlannerSourceState = { status: "loading" };
  const [calendarBundle, weatherBundle] = options.includeExternal === false
    ? [{ events: [], state: loadingState }, { forecasts: new Map(), state: loadingState }]
    : await Promise.all([
      getHouseholdCalendarEvents(
        context.householdId,
        members.map((member) => ({ userId: member.userId })),
        weekStart,
        household.timezone,
      ),
      getWeatherForAssignments(assignments),
    ]);

  const items = planningResult.rows.map(mapPlanningItem);
  const categories: PlanningCategory[] = categoriesResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
  }));
  const hiddenEventIds = new Set(hiddenEventsResult.rows.map((row) => row.event_id));

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
        sortCalendarEvents(
          calendarBundle.events.filter(
            (event) => !hiddenEventIds.has(event.id) && eventFallsOnDate(event, date, household.timezone),
          ),
        ),
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

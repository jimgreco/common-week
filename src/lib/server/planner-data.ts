import "server-only";

import { eventFallsOnDate, markCalendarConflicts, sortCalendarEvents } from "@/lib/calendar-utils";
import { weekDates } from "@/lib/date";
import { canHouseholdMemberWriteGoogleCalendar } from "@/lib/google-calendar-permissions";
import { query } from "@/lib/server/database";
import { GOOGLE_CALENDAR_WRITE_SCOPE, hasGoogleScope } from "@/lib/server/google-oauth";
import { getHouseholdCalendarEvents } from "@/lib/server/calendar-data";
import { carryOverOpenTasks } from "@/lib/server/planning-carryover";
import { getWeatherForAssignments } from "@/lib/server/weather-data";
import type {
  HouseholdLocation,
  HouseholdMember,
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
  text: string;
  is_completed: boolean;
  sort_order: number;
  created_by: string;
  created_by_name: string;
  updated_at: Date;
  original_planning_date: string | null;
  original_week_start_date: string;
  carryover_count: number;
  last_carried_at: Date | null;
  reminder_id: string | null;
  remind_at: Date | null;
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
    text: row.text,
    isCompleted: row.is_completed,
    sortOrder: row.sort_order,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    updatedAt: row.updated_at.toISOString(),
    originalPlanningDate: row.original_planning_date,
    originalWeekStartDate: row.original_week_start_date,
    carryoverCount: row.carryover_count,
    lastCarriedAt: row.last_carried_at?.toISOString() ?? null,
    saveState: "saved",
    reminder: row.reminder_id && row.remind_at
      ? { id: row.reminder_id, resourceKind: "planning_item", remindAt: row.remind_at.toISOString() }
      : null,
  };
}

export async function getPlannerData(
  context: PlannerContext,
  weekStart: string,
  options: { includeExternal?: boolean } = {},
): Promise<WeeklyPlannerData> {
  const dates = weekDates(weekStart);
  const householdResult = await query<HouseholdRow>(
    `select h.id, h.name, h.timezone, h.temperature_unit, h.default_location_id
       from households h
       join household_members hm on hm.household_id = h.id
      where h.id = $1 and hm.user_id = $2`,
    [context.householdId, context.userId],
  );
  const household = householdResult.rows[0];
  if (!household) throw new Error("The household planner could not be loaded.");

  await carryOverOpenTasks({
    householdId: context.householdId,
    timeZone: household.timezone,
    requestedWeekStart: weekStart,
  });

  const [locationsResult, settingsResult, planningResult, membersResult, hiddenEventsResult, accessibleCalendarsResult] =
    await Promise.all([
      query<LocationRow>(
        `select id, name, latitude, longitude, timezone, is_saved
           from locations where household_id = $1 order by name`,
        [context.householdId],
      ),
      query<{ date: string; member_id: string; location_id: string }>(
        `select date::text, member_id, location_id from daily_member_settings
          where household_id = $1 and date between $2::date and $3::date`,
        [context.householdId, dates[0], dates[6]],
      ),
      query<PlanningRow>(
        `select pi.id, pi.planning_date::text, pi.week_start_date::text, pi.type,
                pi.text, pi.is_completed, pi.sort_order, pi.created_by,
                u.display_name as created_by_name, pi.updated_at,
                pi.original_planning_date::text, pi.original_week_start_date::text,
                pi.carryover_count, pi.last_carried_at,
                nr.id as reminder_id, nr.remind_at
           from planning_items pi
           join users u on u.id = pi.created_by
           left join notification_reminders nr
             on nr.planning_item_id = pi.id and nr.user_id = $3 and nr.delivered_at is null
          where pi.household_id = $1 and pi.week_start_date = $2::date
          order by pi.sort_order, pi.created_at`,
        [context.householdId, weekStart, context.userId],
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
      query<{
        id: string;
        user_id: string;
        google_calendar_id: string;
        calendar_name: string;
        display_alias: string | null;
        color: string;
        section_group: "critical" | "supplemental";
        access_role: "freeBusyReader" | "reader" | "writer" | "owner";
        actor_access_role: "freeBusyReader" | "reader" | "writer" | "owner" | null;
        visibility: "hide" | "private" | "share";
        actor_scope: string | null;
      }>(
        `select cp.id, cp.user_id, cp.google_calendar_id, cp.calendar_name,
                cp.display_alias, cp.color, cp.section_group, cp.access_role,
                actor_cp.access_role as actor_access_role, cp.visibility,
                actor_gc.scope as actor_scope
           from calendar_preferences cp
           join google_connections owner_gc on owner_gc.user_id = cp.user_id
           left join calendar_preferences actor_cp
             on actor_cp.household_id = cp.household_id
            and actor_cp.user_id = $2
            and actor_cp.google_calendar_id = cp.google_calendar_id
           left join google_connections actor_gc on actor_gc.user_id = $2
          where cp.household_id = $1
            and (cp.user_id = $2 or cp.visibility = 'share')
          order by (cp.user_id = $2) desc, cp.is_primary desc, cp.calendar_name`,
        [context.householdId, context.userId],
      ),
    ]);

  const allLocations = locationsResult.rows.map((row) => mapLocation(row, household.default_location_id));
  const locations = allLocations.filter((location) => location.isSaved);
  const locationById = new Map(allLocations.map((location) => [location.id, location]));
  const defaultLocation = household.default_location_id
    ? locationById.get(household.default_location_id) ?? null
    : null;
  const members: HouseholdMember[] = membersResult.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
  }));
  const overrides = new Map(settingsResult.rows.map((row) => [`${row.member_id}:${row.date}`, row.location_id]));
  const assignments = dates.flatMap((date) => members.map((member) => ({
    date,
    member,
    location: locationById.get(overrides.get(`${member.id}:${date}`) ?? "") ?? defaultLocation,
  })));
  const loadingState: PlannerSourceState = { status: "loading" };
  const [calendarBundle, weatherBundle] = options.includeExternal === false
    ? [{ events: [], state: loadingState }, { forecasts: new Map(), state: loadingState }]
    : await Promise.all([
      getHouseholdCalendarEvents(
        context.householdId,
        members.map((member) => ({ userId: member.userId })),
        context.userId,
        weekStart,
        household.timezone,
      ),
      getWeatherForAssignments(assignments),
    ]);

  const items = planningResult.rows.map(mapPlanningItem);
  const calendarReminders = calendarBundle.events.length
    ? await query<{ id: string; calendar_preference_id: string; provider_event_id: string; remind_at: Date }>(
      `select id, calendar_preference_id, provider_event_id, remind_at
         from notification_reminders
        where user_id = $1 and resource_kind = 'calendar_event' and delivered_at is null
          and calendar_preference_id = any($2::uuid[])`,
      [
        context.userId,
        Array.from(new Set(calendarBundle.events.map((event) => event.calendarPreferenceId).filter(Boolean))),
      ],
    )
    : { rows: [] as Array<{ id: string; calendar_preference_id: string; provider_event_id: string; remind_at: Date }> };
  const reminderByEvent = new Map(calendarReminders.rows.map((row) => [
    `${row.calendar_preference_id}:${row.provider_event_id}`,
    { id: row.id, resourceKind: "calendar_event" as const, remindAt: row.remind_at.toISOString() },
  ]));
  const hiddenEventIds = new Set(hiddenEventsResult.rows.map((row) => row.event_id));
  const actorRole = members.find((member) => member.userId === context.userId)?.role ?? "viewer";
  const writablePreferenceIds = new Set(
    accessibleCalendarsResult.rows
      .filter((calendar) => canHouseholdMemberWriteGoogleCalendar({
        actorRole,
        actorUserId: context.userId,
        calendarOwnerUserId: calendar.user_id,
        visibility: calendar.visibility,
        actorAccessRole: calendar.actor_access_role,
        calendarWriteEnabled: hasGoogleScope(calendar.actor_scope, GOOGLE_CALENDAR_WRITE_SCOPE),
      }))
      .map((calendar) => calendar.id),
  );
  const visibleCalendarRows = accessibleCalendarsResult.rows.filter((calendar) => (
    calendar.visibility === "share"
    || (calendar.user_id === context.userId && calendar.visibility === "private")
  ));

  return {
    household: {
      id: household.id,
      name: household.name,
      timezone: household.timezone,
      temperatureUnit: household.temperature_unit,
    },
    members,
    weekStart,
    days: dates.map((date) => {
      const memberLocations = assignments.filter((assignment) => assignment.date === date).map(({ member, location }) => ({
        memberId: member.id,
        userId: member.userId,
        displayName: member.displayName,
        location,
        weather: location ? weatherBundle.forecasts.get(`${location.id}:${date}`) ?? null : null,
      }));
      const sharedLocationId = memberLocations[0]?.location?.id;
      const hasSharedLocation = Boolean(sharedLocationId) && memberLocations.every((assignment) => assignment.location?.id === sharedLocationId);
      return {
      date,
      location: hasSharedLocation ? memberLocations[0].location : null,
      weather: hasSharedLocation ? memberLocations[0].weather : null,
      memberLocations,
      events: markCalendarConflicts(
        sortCalendarEvents(
          calendarBundle.events.filter(
            (event) => !hiddenEventIds.has(event.id) && eventFallsOnDate(event, date, household.timezone),
          ).map((event) => ({
            ...event,
            canEdit: Boolean(event.calendarPreferenceId && writablePreferenceIds.has(event.calendarPreferenceId)),
            canRespond: event.sourceUserId === context.userId && Boolean(event.attendees?.some((attendee) => attendee.self)),
            reminder: event.calendarPreferenceId && event.providerEventId
              ? reminderByEvent.get(`${event.calendarPreferenceId}:${event.providerEventId}`) ?? null
              : null,
          })),
        ),
      ),
      items: items.filter((item) => item.planningDate === date),
    }; }),
    weeklyItems: items.filter((item) => item.planningDate === null),
    locations,
    visibleCalendars: visibleCalendarRows.map((calendar) => ({
      id: calendar.id,
      sourceUserId: calendar.user_id,
      name: calendar.display_alias ?? calendar.calendar_name,
      color: calendar.color,
      sectionGroup: calendar.section_group,
    })),
    editableCalendars: visibleCalendarRows
      .filter((calendar) => writablePreferenceIds.has(calendar.id))
      .map((calendar) => ({
        id: calendar.id,
        sourceUserId: calendar.user_id,
        name: calendar.display_alias ?? calendar.calendar_name,
        color: calendar.color,
        sectionGroup: calendar.section_group,
      })),
    calendarState: calendarBundle.state,
    weatherState: weatherBundle.state,
    isDemo: false,
  };
}

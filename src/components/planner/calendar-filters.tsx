import { CalendarDays, RotateCcw, UserRound } from "lucide-react";
import type { CalendarEvent, EditableCalendar, HouseholdMember, PlanningItem } from "@/types/domain";

export const ALL_CALENDARS = "all-calendars";
export const ALL_PEOPLE = "all-people";
export const UNASSIGNED = "unassigned";

function memberIdsMatchPerson(memberIds: string[], personId: string): boolean {
  return personId === ALL_PEOPLE || (personId === UNASSIGNED ? memberIds.length === 0 : memberIds.includes(personId));
}

export function planningItemMatchesPerson(item: PlanningItem, personId: string): boolean {
  return memberIdsMatchPerson(item.assignedMemberIds ?? (item.childId ? [item.childId] : []), personId);
}

export function calendarEventMatchesFilters(
  event: CalendarEvent,
  calendarId: string,
  personId: string,
): boolean {
  const eventCalendarId = event.calendarPreferenceId ?? event.calendarId;
  return (calendarId === ALL_CALENDARS || eventCalendarId === calendarId)
    && memberIdsMatchPerson(event.assignedMemberIds ?? event.assignedAdultUserIds ?? (event.sourceUserId ? [event.sourceUserId] : []), personId);
}

export function CalendarFilters({
  calendars,
  members,
  childProfiles = [],
  calendarId,
  personId,
  onCalendar,
  onPerson,
  onClear,
}: {
  calendars: EditableCalendar[];
  members: HouseholdMember[];
  childProfiles?: { id: string; name: string }[];
  calendarId: string;
  personId: string;
  onCalendar: (calendarId: string) => void;
  onPerson: (personId: string) => void;
  onClear: () => void;
}) {
  const memberName = new Map(members.map((member) => [member.userId, member.displayName]));
  const active = calendarId !== ALL_CALENDARS || personId !== ALL_PEOPLE;

  return (
    <div className="planner-filters" aria-label="Calendar filters">
      <label>
        <CalendarDays size={14} aria-hidden="true" />
        <span>Calendar</span>
        <select aria-label="Calendar filter" value={calendarId} onChange={(event) => onCalendar(event.target.value)}>
          <option value={ALL_CALENDARS}>All calendars</option>
          {calendars.map((calendar) => (
            <option value={calendar.id} key={calendar.id}>
              {calendar.name}{calendar.sourceUserId && memberName.get(calendar.sourceUserId) ? ` · ${memberName.get(calendar.sourceUserId)}` : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        <UserRound size={14} aria-hidden="true" />
        <span>Person</span>
        <select aria-label="Person filter" value={personId} onChange={(event) => onPerson(event.target.value)}>
          <option value={ALL_PEOPLE}>Everyone</option>
          <option value={UNASSIGNED}>Unassigned</option>
          {members.map((member) => <option value={member.userId} key={member.userId}>{member.displayName}</option>)}
          {childProfiles.map((child) => <option value={child.id} key={child.id}>{child.name}</option>)}
        </select>
      </label>
      {active && <button type="button" onClick={onClear}><RotateCcw size={12} aria-hidden="true" />Clear filters</button>}
    </div>
  );
}

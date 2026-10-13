import { CalendarDays, RotateCcw } from "lucide-react";
import { ChildBadge } from "@/components/planner/family-planning-fields";
import type { CalendarEvent, ChildProfile, EditableCalendar, HouseholdMember, PlanningItem } from "@/types/domain";

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

export function PersonFilters({ members, childProfiles, personId, onPerson }: {
  members: HouseholdMember[];
  childProfiles: ChildProfile[];
  personId: string;
  onPerson: (personId: string) => void;
}) {
  return <div className="person-filter-buttons" role="group" aria-label="Person filter">
    <button type="button" className={personId === ALL_PEOPLE ? "is-active" : ""} aria-pressed={personId === ALL_PEOPLE} onClick={() => onPerson(ALL_PEOPLE)}>Everyone</button>
    {members.map((member) => <button type="button" key={member.userId} className={personId === member.userId ? "is-active" : ""} aria-pressed={personId === member.userId} onClick={() => onPerson(member.userId)}>{member.displayName}</button>)}
    {childProfiles.map((child) => <button type="button" key={child.id} className={personId === child.id ? "is-active" : ""} aria-pressed={personId === child.id} onClick={() => onPerson(child.id)}><ChildBadge child={child} /></button>)}
    <button type="button" className={personId === UNASSIGNED ? "is-active" : ""} aria-pressed={personId === UNASSIGNED} onClick={() => onPerson(UNASSIGNED)}>Unassigned</button>
  </div>;
}

export function CalendarFilters({
  calendars,
  members,
  calendarId,
  personId,
  onCalendar,
  onClear,
}: {
  calendars: EditableCalendar[];
  members: HouseholdMember[];
  calendarId: string;
  personId: string;
  onCalendar: (calendarId: string) => void;
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
      {active && <button type="button" onClick={onClear}><RotateCcw size={12} aria-hidden="true" />Clear filters</button>}
    </div>
  );
}

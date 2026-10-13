import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ALL_CALENDARS, ALL_PEOPLE, UNASSIGNED, planningItemMatchesPerson, CalendarFilters, PersonFilters, calendarEventMatchesFilters } from "@/components/planner/calendar-filters";
import { getDemoPlannerData } from "@/lib/demo-data";

function FilterHarness() {
  const data = getDemoPlannerData();
  const [calendarId, setCalendarId] = useState(ALL_CALENDARS);
  const [personId, setPersonId] = useState(ALL_PEOPLE);
  return <>
    <PersonFilters members={data.members} childProfiles={[{ id: "child", name: "Miriam", color: "#587f9b", calendarPreferenceIds: [] }]} personId={personId} onPerson={setPersonId} />
    <CalendarFilters
      calendars={data.visibleCalendars}
      members={data.members}
      calendarId={calendarId}
      personId={personId}
      onCalendar={setCalendarId}
      onClear={() => { setCalendarId(ALL_CALENDARS); setPersonId(ALL_PEOPLE); }}
    />
  </>;
}

describe("CalendarFilters", () => {
  it("finds unassigned events while preserving explicit empty assignments and calendar filters", () => {
    const event = getDemoPlannerData().days.flatMap((day) => day.events)[0];
    const assigned = { ...event, assignedMemberIds: ["child"], assignedAdultUserIds: ["adult"] };
    expect(calendarEventMatchesFilters(assigned, ALL_CALENDARS, UNASSIGNED)).toBe(false);
    const cleared = { ...assigned, assignedMemberIds: [] };
    expect(calendarEventMatchesFilters(cleared, ALL_CALENDARS, UNASSIGNED)).toBe(true);
    expect(calendarEventMatchesFilters(cleared, "another-calendar", UNASSIGNED)).toBe(false);
    expect(calendarEventMatchesFilters({ ...assigned, assignedMemberIds: undefined }, ALL_CALENDARS, UNASSIGNED)).toBe(false);
    expect(calendarEventMatchesFilters({ ...assigned, assignedMemberIds: undefined, assignedAdultUserIds: [] }, ALL_CALENDARS, UNASSIGNED)).toBe(true);
    expect(calendarEventMatchesFilters({ ...event, assignedMemberIds: undefined, assignedAdultUserIds: undefined, sourceUserId: undefined }, ALL_CALENDARS, UNASSIGNED)).toBe(true);
    expect(calendarEventMatchesFilters({ ...event, assignedMemberIds: undefined, assignedAdultUserIds: undefined, sourceUserId: "connector" }, ALL_CALENDARS, UNASSIGNED)).toBe(false);
  });

  it("finds unassigned daily and weekly tasks and notes, regardless of their creator", () => {
    const data = getDemoPlannerData();
    for (const item of [...data.weeklyItems, ...data.days.flatMap((day) => day.items)]) {
      expect(planningItemMatchesPerson({ ...item, assignedMemberIds: undefined, childId: null }, UNASSIGNED)).toBe(true);
      expect(planningItemMatchesPerson({ ...item, assignedMemberIds: ["adult", "child"] }, UNASSIGNED)).toBe(false);
      expect(planningItemMatchesPerson({ ...item, assignedMemberIds: undefined, childId: "child" }, UNASSIGNED)).toBe(false);
      expect(planningItemMatchesPerson({ ...item, assignedMemberIds: [], childId: "child" }, UNASSIGNED)).toBe(true);
      expect(planningItemMatchesPerson({ ...item, assignedMemberIds: ["child"] }, "child")).toBe(true);
      expect(planningItemMatchesPerson({ ...item, assignedMemberIds: [] }, ALL_PEOPLE)).toBe(true);
    }
  });

  it("lets the user select Unassigned and clear the filter", () => {
    render(<FilterHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Unassigned" }));
    expect(screen.getByRole("button", { name: "Unassigned" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("button", { name: "Everyone" })).toHaveAttribute("aria-pressed", "true");
  });

  it("uses explicit adult assignments instead of calendar connection ownership", () => {
    const event = getDemoPlannerData().days.flatMap((day) => day.events)[0];
    const assigned = { ...event, sourceUserId: "connector", assignedAdultUserIds: ["alex", "sam"] };
    expect(calendarEventMatchesFilters(assigned, ALL_CALENDARS, "alex")).toBe(true);
    expect(calendarEventMatchesFilters(assigned, ALL_CALENDARS, "sam")).toBe(true);
    expect(calendarEventMatchesFilters(assigned, ALL_CALENDARS, "connector")).toBe(false);
    expect(calendarEventMatchesFilters({ ...assigned, assignedAdultUserIds: [] }, ALL_CALENDARS, "connector")).toBe(false);
    expect(calendarEventMatchesFilters(assigned, "another-calendar", "alex")).toBe(false);
  });
  it("filters events by both calendar and source person", () => {
    const data = getDemoPlannerData();
    const familyEvent = data.days.flatMap((day) => day.events).find((event) => event.calendarPreferenceId === "demo-F")!;
    const rachelEvent = data.days.flatMap((day) => day.events).find((event) => event.sourceUserId === "demo-rachel")!;

    expect(calendarEventMatchesFilters(familyEvent, "demo-F", "demo-jim")).toBe(true);
    expect(calendarEventMatchesFilters(familyEvent, "demo-R", ALL_PEOPLE)).toBe(false);
    expect(calendarEventMatchesFilters(rachelEvent, ALL_CALENDARS, "demo-jim")).toBe(false);
  });

  it("offers every assignable household member beside Everyone and resets both filters", () => {
    render(<FilterHarness />);

    expect(screen.queryByRole("combobox", { name: "Person filter" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jim" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rachel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Miriam" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Calendar filter" }), { target: { value: "demo-R" } });
    fireEvent.click(screen.getByRole("button", { name: "Rachel" }));
    expect(screen.getByRole("combobox", { name: "Calendar filter" })).toHaveValue("demo-R");
    expect(screen.getByRole("button", { name: "Rachel" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Miriam" }));
    expect(screen.getByRole("button", { name: "Miriam" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Rachel" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("combobox", { name: "Calendar filter" })).toHaveValue(ALL_CALENDARS);
    expect(screen.getByRole("button", { name: "Everyone" })).toHaveAttribute("aria-pressed", "true");
  });
});

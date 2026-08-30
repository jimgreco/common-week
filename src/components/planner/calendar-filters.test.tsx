import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ALL_CALENDARS, ALL_PEOPLE, CalendarFilters, calendarEventMatchesFilters } from "@/components/planner/calendar-filters";
import { getDemoPlannerData } from "@/lib/demo-data";

function FilterHarness() {
  const data = getDemoPlannerData();
  const [calendarId, setCalendarId] = useState(ALL_CALENDARS);
  const [personId, setPersonId] = useState(ALL_PEOPLE);
  return <CalendarFilters
    calendars={data.visibleCalendars}
    members={data.members}
    calendarId={calendarId}
    personId={personId}
    onCalendar={setCalendarId}
    onPerson={setPersonId}
    onClear={() => { setCalendarId(ALL_CALENDARS); setPersonId(ALL_PEOPLE); }}
  />;
}

describe("CalendarFilters", () => {
  it("filters events by both calendar and source person", () => {
    const data = getDemoPlannerData();
    const familyEvent = data.days.flatMap((day) => day.events).find((event) => event.calendarPreferenceId === "demo-F")!;
    const rachelEvent = data.days.flatMap((day) => day.events).find((event) => event.sourceUserId === "demo-rachel")!;

    expect(calendarEventMatchesFilters(familyEvent, "demo-F", "demo-jim")).toBe(true);
    expect(calendarEventMatchesFilters(familyEvent, "demo-R", ALL_PEOPLE)).toBe(false);
    expect(calendarEventMatchesFilters(rachelEvent, ALL_CALENDARS, "demo-jim")).toBe(false);
  });

  it("offers calendar and person controls and resets both", () => {
    render(<FilterHarness />);

    fireEvent.change(screen.getByRole("combobox", { name: "Calendar filter" }), { target: { value: "demo-R" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Person filter" }), { target: { value: "demo-rachel" } });
    expect(screen.getByRole("combobox", { name: "Calendar filter" })).toHaveValue("demo-R");
    expect(screen.getByRole("combobox", { name: "Person filter" })).toHaveValue("demo-rachel");

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("combobox", { name: "Calendar filter" })).toHaveValue(ALL_CALENDARS);
    expect(screen.getByRole("combobox", { name: "Person filter" })).toHaveValue(ALL_PEOPLE);
  });
});

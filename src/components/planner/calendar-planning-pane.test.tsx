import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarPlanningPane } from "./calendar-planning-pane";
import { getDemoPlannerData } from "@/lib/demo-data";
import { formatMobileDate } from "@/lib/date";

const data = getDemoPlannerData();
const base = data.days.flatMap((day) => day.items)[0];
const task = { ...base, id: "daily-task", text: "Pack lunch", type: "task" as const, isCompleted: false, planningDate: data.days[0].date };
const note = { ...base, id: "daily-note", text: "Dinner at home", type: "note" as const, isCompleted: false, planningDate: data.days[0].date };
const weekly = { ...task, id: "weekly-task", text: "Book a sitter", planningDate: null };
const firstDay = { ...data.days[0], items: [task, note] };
const secondDay = { ...data.days[1], items: [{ ...task, id: "tomorrow", text: "Tomorrow only", planningDate: data.days[1].date }] };
const actions = () => ({ onAdd: vi.fn(), onToggle: vi.fn(), onEdit: vi.fn(), onRetry: vi.fn() });

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});

describe("calendar tasks and notes pane", () => {
  it("starts compact on phones and keeps the quick-add draft when collapsed", () => {
    const callbacks = actions();
    render(<CalendarPlanningPane days={[firstDay]} weeklyItems={[weekly]} childProfiles={[]} canEdit {...callbacks} />);
    const toggle = screen.getByRole("button", { name: /Tasks & Notes/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("2 tasks left · 1 note");
    expect(screen.queryByRole("button", { name: "Pack lunch" })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: `Add note for ${formatMobileDate(firstDay.date)}` }));
    const inputName = `New note for ${formatMobileDate(firstDay.date)}`;
    fireEvent.change(screen.getByRole("textbox", { name: inputName }), { target: { value: "Bring swim bags" } });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(screen.getByRole("textbox", { name: inputName })).toHaveValue("Bring swim bags");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(callbacks.onAdd).toHaveBeenCalledWith(firstDay.date, "Bring swim bags", "note");
  });

  it("shows only the supplied day plus weekly items and expands to grouped week items", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    const props = { weeklyItems: [weekly], childProfiles: [], canEdit: true, ...actions() };
    const { rerender } = render(<CalendarPlanningPane days={[firstDay]} {...props} />);
    expect(screen.getByRole("button", { name: /Tasks & Notes/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("button", { name: "Tomorrow only" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Book a sitter" })).toHaveLength(1);
    rerender(<CalendarPlanningPane days={[firstDay, secondDay]} {...props} />);
    expect(within(screen.getByRole("region", { name: `${formatMobileDate(secondDay.date)} tasks and notes` })).getByRole("button", { name: "Tomorrow only" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Book a sitter" })).toHaveLength(1);
  });

  it("uses the existing completion and editing actions and adds a whole-week task without a date", () => {
    const callbacks = actions();
    render(<CalendarPlanningPane days={[firstDay]} weeklyItems={[weekly]} childProfiles={[]} canEdit {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: /Tasks & Notes/ }));
    fireEvent.click(screen.getByRole("button", { name: "Complete: Pack lunch" }));
    expect(callbacks.onToggle).toHaveBeenCalledWith(task, true);
    fireEvent.click(screen.getByRole("button", { name: "Dinner at home" }));
    expect(callbacks.onEdit).toHaveBeenCalledWith(note);
    fireEvent.click(screen.getByRole("button", { name: "Add task for This week" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New task for This week" }), { target: { value: "Call school" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(callbacks.onAdd).toHaveBeenCalledWith(null, "Call school", "task");
  });

  it("keeps read-only details reachable while disabling task mutations", () => {
    render(<CalendarPlanningPane days={[firstDay]} weeklyItems={[]} childProfiles={[]} canEdit={false} {...actions()} />);
    fireEvent.click(screen.getByRole("button", { name: /Tasks & Notes/ }));
    expect(screen.getByRole("button", { name: "Complete: Pack lunch" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Dinner at home" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Add task for/ })).not.toBeInTheDocument();
  });
});

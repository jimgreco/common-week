import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FamilyPlanningPanel, RoutineFields } from "@/components/planner/family-planning";
import { routineDescription } from "@/components/planner/family-planning-fields";
import { ItemEditorDialog } from "@/components/planner/dialogs";
import { emptyFamilyPlanning } from "@/components/planner/family-planning-demo";
import { getDemoPlannerData } from "@/lib/demo-data";
import type { FamilyPlanningData, PlanningItem, WeeklyPlannerData } from "@/types/domain";

vi.mock("@/app/actions/planner", () => ({ searchLocationsAction: vi.fn() }));
const data: WeeklyPlannerData = { ...getDemoPlannerData("2026-09-07"), visibleCalendars: [{ id: "calendar-1", name: "School", color: "#176b55", sectionGroup: "critical" }], members: [{ id: "member-1", userId: "user-1", displayName: "Alex", email: "alex@example.com", role: "owner" }] };
const base = (): FamilyPlanningData => emptyFamilyPlanning(data.weekStart, "user-1");
const task: PlanningItem = { id: "task-1", text: "School bag", planningDate: "2026-09-07", weekStartDate: data.weekStart, type: "task", isCompleted: false, createdBy: "user-1", sortOrder: 0, updatedAt: "2026-09-07T12:00:00Z" };
const callbacks = { onClose: vi.fn(), onToggle: vi.fn().mockResolvedValue(undefined), onEdit: vi.fn(), onMove: vi.fn().mockResolvedValue(null), onEvent: vi.fn() };

describe("FamilyPlanningPanel", () => {
  it("keeps child profile and calendar link edits through a failed save and retries with the same identity", async () => {
    const onMutation = vi.fn().mockResolvedValueOnce("Connection interrupted").mockResolvedValue(null);
    render(<FamilyPlanningPanel family={base()} data={data} items={[]} onMutation={onMutation} initialStep={3} {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: /Add a child/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Child’s name" }), { target: { value: "Maya" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "School" }));
    fireEvent.click(screen.getByRole("button", { name: "Add child" }));
    await screen.findAllByText("Connection interrupted");
    expect(screen.getByRole("textbox", { name: "Child’s name" })).toHaveValue("Maya");
    fireEvent.click(screen.getByRole("button", { name: "Add child" }));
    await waitFor(() => expect(onMutation).toHaveBeenCalledTimes(2));
    expect(onMutation.mock.calls[0][0]).toEqual(onMutation.mock.calls[1][0]);
    expect(onMutation.mock.calls[0][0]).toMatchObject({ action: "saveChild", child: { name: "Maya", calendarPreferenceIds: ["calendar-1"] } });
  });

  it("retains a stable template identity after an uncertain save", async () => {
    const onMutation = vi.fn().mockResolvedValueOnce("Please retry").mockResolvedValue(null);
    render(<FamilyPlanningPanel family={base()} data={data} items={[task]} onMutation={onMutation} initialStep={2} {...callbacks} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Save this week as a template" }), { target: { value: "School week" } });
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));
    await waitFor(() => expect(onMutation).toHaveBeenCalledTimes(2));
    expect(onMutation.mock.calls[0][0].id).toBeTruthy();
    expect(onMutation.mock.calls[0][0]).toEqual(onMutation.mock.calls[1][0]);
  });

  it("keeps a dirty shared-notes draft when another adult changes the plan", async () => {
    const family = base();
    const onMutation = vi.fn().mockResolvedValue(null);
    const view = render(<FamilyPlanningPanel family={family} data={data} items={[]} onMutation={onMutation} initialStep={4} {...callbacks} />);
    fireEvent.change(screen.getByRole("textbox", { name: /Our priorities/ }), { target: { value: "My unfinished idea" } });
    const newer = { ...family, review: { ...family.review, priorities: "Other adult’s saved plan", revision: 1 } };
    view.rerender(<FamilyPlanningPanel family={newer} data={data} items={[]} onMutation={onMutation} initialStep={4} {...callbacks} />);
    expect(screen.getByRole("textbox", { name: /Our priorities/ })).toHaveValue("My unfinished idea");
    fireEvent.click(screen.getByRole("button", { name: "Replace my draft with the latest notes" }));
    expect(screen.getByRole("textbox", { name: /Our priorities/ })).toHaveValue("Other adult’s saved plan");
  });

  it("acknowledges only the current user at the visible review revision", async () => {
    const family = base();
    family.review.revision = 7;
    const onMutation = vi.fn().mockResolvedValue(null);
    render(<FamilyPlanningPanel family={family} data={data} items={[]} onMutation={onMutation} initialStep={5} {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "I’ve reviewed this week" }));
    await waitFor(() => expect(onMutation).toHaveBeenCalledWith({ action: "markReviewed", weekStart: data.weekStart, reviewed: true, revision: 7 }));
  });

  it("does not claim an empty week when calendars are still loading", () => {
    render(<FamilyPlanningPanel family={base()} data={{ ...data, days: data.days.map((day) => ({ ...day, events: [] })), calendarState: { status: "loading" } }} items={[]} onMutation={vi.fn()} initialStep={1} {...callbacks} />);
    expect(screen.getByRole("status")).toHaveTextContent("still loading");
    expect(screen.queryByText("No calendar events")).not.toBeInTheDocument();
    expect(screen.getAllByText("No events loaded")).toHaveLength(7);
  });
});

describe("Repeating shared-task editor", () => {
  it("shows and preserves weekday restrictions on daily routines from another client", () => {
    const onChange = vi.fn();
    const routine = { text: "School bag", childId: null, frequency: "daily" as const, interval: 1, weekdays: [0, 1, 2, 3, 4], startsOn: "2026-09-07", endsOn: null, active: true };
    render(<RoutineFields value={routine} onChange={onChange} />);
    expect(screen.getByRole("checkbox", { name: "Fri" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Sat" })).not.toBeChecked();
    expect(routineDescription(routine)).toBe("Every day · Mon, Tue, Wed, Thu, Fri");
    fireEvent.change(screen.getByRole("spinbutton", { name: /Repeat every/ }), { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ frequency: "daily", interval: 2, weekdays: [0, 1, 2, 3, 4] }));
  });

  it("adopts the source task identity and leaves failed recurrence edits open", async () => {
    const onSave = vi.fn();
    const onRepeat = vi.fn().mockResolvedValue("Choose another start date");
    render(<ItemEditorDialog item={task} weekDates={["2026-09-07"]} timeZone="America/New_York" onClose={vi.fn()} onSave={onSave} onDelete={vi.fn()} onRepeat={onRepeat} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Repeat this shared task" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose another start date");
    expect(onRepeat).toHaveBeenCalledWith(expect.objectContaining({ text: task.text, startsOn: task.planningDate, weekdays: [0] }), task.id);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("allows a custom repeat interval without replacing the selected weekdays", () => {
    const onChange = vi.fn();
    render(<RoutineFields value={{ text: "Deep clean", childId: null, frequency: "weekly", interval: 3, weekdays: [2], startsOn: "2026-09-07", endsOn: null, active: true }} onChange={onChange} />);
    fireEvent.change(screen.getByRole("spinbutton", { name: /Repeat every/ }), { target: { value: "4" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ interval: 4, weekdays: [2] }));
  });
});

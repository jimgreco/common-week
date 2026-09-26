import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDemoPlannerData } from "@/lib/demo-data";
import { emptyFamilyPlanning } from "./family-planning-demo";
import type { ActionResult, PlanningItem, WeeklyPlannerData } from "@/types/domain";

const mocks = vi.hoisted(() => ({ create: vi.fn(), toggle: vi.fn(), router: { refresh: vi.fn(), push: vi.fn(), replace: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router, useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/actions/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/app/actions/planner", () => ({ createPlanningItemAction: mocks.create, deletePlanningItemAction: vi.fn(), hideCalendarEventAction: vi.fn(), searchPlannerAction: vi.fn(), setDailyLocationAction: vi.fn(), setGeocodedLocationAction: vi.fn(), togglePlanningItemAction: mocks.toggle, updatePlanningItemAction: vi.fn() }));
vi.mock("@/app/actions/calendar", () => ({ createCalendarEventAction: vi.fn(), deleteCalendarEventAction: vi.fn(), respondToCalendarEventAction: vi.fn(), updateCalendarEventAction: vi.fn() }));
vi.mock("@/app/actions/notifications", () => ({ setCalendarReminderAction: vi.fn() }));
vi.mock("@/app/actions/family-planning", () => ({ loadFamilyPlanningAction: vi.fn(), mutateFamilyPlanningAction: vi.fn() }));
vi.mock("@/app/actions/household-assignments", () => ({ saveEventMembersAction: vi.fn() }));
vi.mock("@/components/theme-provider", () => ({ useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }) }));
vi.mock("./use-planner-source", () => ({ usePlannerSource: () => vi.fn() }));
vi.mock("./coverage-panel", () => ({ CoveragePanel: () => null }));
vi.mock("./week-share", () => ({ WeekShare: () => null }));
vi.mock("./family-planning", () => ({ FamilyPlanningPanel: () => null }));
vi.mock("./notification-inbox", () => ({ NotificationInboxButton: () => null }));
vi.mock("./task-workspace", () => ({ TaskWorkspaceProvider: ({ children }: { children: ReactNode }) => children, TaskWorkspaceDialog: () => null }));
vi.mock("./dialogs", () => ({ CalendarEventEditorDialog: () => null, EventDetailDialog: () => null, ItemEditorDialog: () => null, LocationDialog: () => null, SearchDialog: () => null, WeatherDialog: () => null }));

import { WeeklyPlanner } from "./weekly-planner";

const week = "2026-09-21";
function dataFor(start = week): WeeklyPlannerData {
  const data = getDemoPlannerData(start);
  return { ...data, isDemo: false, days: data.days.map(day => ({ ...day, items: [] })), weeklyItems: [] };
}
function planner(data: WeeklyPlannerData) {
  return <WeeklyPlanner initialData={data} currentUserName="Jim" currentUserId="user-1" initialFamily={emptyFamilyPlanning(data.weekStart, "user-1")} initialInbox={{ items: [], unreadCount: 0 }} />;
}
function addWeeklyTask(text: string) {
  const input = screen.getByRole("textbox", { name: "Add weekly task" });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form")!);
}
function savedItem(text: string, weekStartDate = week): PlanningItem {
  return { id: "00000000-0000-4000-8000-000000000001", text, type: "task", planningDate: null, weekStartDate, isCompleted: false, sortOrder: 0, createdBy: "user-1", updatedAt: new Date().toISOString(), saveState: "saved" };
}

beforeEach(() => {
  mocks.create.mockReset();
  mocks.toggle.mockReset();
  vi.stubGlobal("EventSource", class { addEventListener() {} close() {} });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("planner saves across retries and navigation", () => {
  it("retains the draft and offers retry when the request itself rejects", async () => {
    mocks.create.mockRejectedValue(new TypeError("Failed to fetch"));
    render(planner(dataFor()));
    addWeeklyTask("Offline groceries");
    expect(await screen.findByRole("button", { name: "Retry" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Offline groceries" })).toBeVisible();
    expect(screen.queryByText("Saving")).not.toBeInTheDocument();
  });

  it("rolls back task completion when the request itself rejects", async () => {
    mocks.toggle.mockRejectedValue(new TypeError("Failed to fetch"));
    render(planner({ ...dataFor(), weeklyItems: [savedItem("Still incomplete")] }));
    fireEvent.click(screen.getByRole("button", { name: "Complete: Still incomplete" }));
    await screen.findByText("Connection interrupted. Please try again.");
    expect(screen.getByRole("button", { name: "Complete: Still incomplete" })).toBeVisible();
  });

  it("reuses the create identity after an uncertain response", async () => {
    mocks.create.mockResolvedValue({ ok: false, error: "Connection interrupted" });
    render(planner(dataFor()));
    addWeeklyTask("Retry-safe groceries");
    await screen.findByRole("button", { name: "Retry" });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[0][0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.create.mock.calls[1][0].id).toBe(mocks.create.mock.calls[0][0].id);
  });

  it("keeps a failed weekly draft in its own week", async () => {
    mocks.create.mockResolvedValue({ ok: false, error: "Connection interrupted" });
    const { rerender } = render(planner(dataFor()));
    addWeeklyTask("Only in the first week");
    await screen.findByRole("button", { name: "Retry" });
    rerender(planner(dataFor("2026-09-28")));
    expect(screen.queryByRole("button", { name: "Only in the first week" })).not.toBeInTheDocument();
    rerender(planner(dataFor()));
    expect(screen.getByRole("button", { name: "Only in the first week" })).toBeInTheDocument();
  });

  it("does not inject a late save into the newly selected week", async () => {
    let resolve!: (result: ActionResult<PlanningItem>) => void;
    mocks.create.mockReturnValue(new Promise<ActionResult<PlanningItem>>(yes => { resolve = yes; }));
    const { rerender } = render(planner(dataFor()));
    addWeeklyTask("Slow groceries");
    rerender(planner(dataFor("2026-09-28")));
    await act(async () => { resolve({ ok: true, data: savedItem("Slow groceries") }); });
    expect(screen.queryByRole("button", { name: "Slow groceries" })).not.toBeInTheDocument();
  });

  it("does not show both a failed draft and its committed server copy after refresh", async () => {
    mocks.create.mockResolvedValue({ ok: false, error: "Connection interrupted" });
    const { rerender } = render(planner(dataFor()));
    addWeeklyTask("Already committed groceries");
    await screen.findByRole("button", { name: "Retry" });
    const item = { ...savedItem("Already committed groceries"), id: mocks.create.mock.calls[0][0].id };
    rerender(planner({ ...dataFor(), weeklyItems: [item] }));
    expect(screen.getAllByRole("button", { name: "Already committed groceries" })).toHaveLength(1);
  });
});

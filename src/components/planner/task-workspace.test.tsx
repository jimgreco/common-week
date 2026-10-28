import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemCollaboration, TaskWorkspaceDialog, TaskWorkspaceProvider } from "./task-workspace";
import type { TaskRecord, TaskWorkspaceData } from "@/lib/task-workspace";

vi.mock("./dialogs", () => ({ Modal: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

const empty: TaskWorkspaceData = { tasks: [], entries: [], task: null };
const reply = (data = empty) => ({ json: async () => ({ ok: true, data }) });
const fetchMock = vi.fn();
const changes = vi.fn();
function workspace(children: ReactNode, householdId = "household", userId = "user", canEdit = true) {
  return <TaskWorkspaceProvider timeZone="America/New_York" householdId={householdId} people={[]} userId={userId} canEdit={canEdit} week="2026-10-12" today="2026-10-12" isDemo={false} tasks={[]} onChange={changes}>{children}</TaskWorkspaceProvider>;
}
function posts() { return fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init.body)); }

beforeEach(() => { fetchMock.mockReset().mockResolvedValue(reply()); changes.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("task workspace create retries", () => {
  it.each([
    { scope: "household", householdId: "other-household", userId: "user" },
    { scope: "account", householdId: "household", userId: "other-user" },
  ])("does not reuse drafts or create IDs after changing $scope", async ({ householdId, userId }) => {
    fetchMock.mockImplementation(async (_url, init) => {
      if (init?.method === "POST") throw new TypeError("Connection interrupted");
      return reply();
    });
    const { rerender } = render(workspace(<TaskWorkspaceDialog onClose={vi.fn()} />));
    fireEvent.change(screen.getByRole("textbox", { name: "Capture a task" }), { target: { value: "Pack lunch" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to backlog" }));
    await screen.findByRole("alert");
    rerender(workspace(<TaskWorkspaceDialog onClose={vi.fn()} />, householdId, userId));
    const input = screen.getByRole("textbox", { name: "Capture a task" });
    expect(input).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "Pack lunch" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to backlog" }));
    await screen.findByRole("alert");
    expect(posts()[1].id).not.toBe(posts()[0].id);
  });

  it("reuses a backlog task ID after a lost response, then allows an intentional duplicate", async () => {
    let fail = true;
    fetchMock.mockImplementation(async (_url, init) => {
      if (init?.method === "POST" && fail) throw new TypeError("Connection interrupted");
      return reply();
    });
    render(workspace(<TaskWorkspaceDialog onClose={vi.fn()} />));
    const input = screen.getByRole("textbox", { name: "Capture a task" });
    fireEvent.change(input, { target: { value: "Pack lunch" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to backlog" }));
    await screen.findByRole("alert");
    expect(input).toHaveValue("Pack lunch");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Add to backlog" }));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(posts()[1].id).toBe(posts()[0].id);
    fireEvent.change(input, { target: { value: "Pack lunch" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to backlog" }));
    await waitFor(() => expect(posts()).toHaveLength(3));
    expect(posts()[2].id).not.toBe(posts()[0].id);
  });

  it("ignores repeated Enter while saving and preserves the next task being typed", async () => {
    let resolve!: (value: ReturnType<typeof reply>) => void;
    fetchMock.mockImplementation((_url, init) => init?.method === "POST" ? new Promise((yes) => { resolve = yes; }) : Promise.resolve(reply()));
    render(workspace(<TaskWorkspaceDialog onClose={vi.fn()} />));
    const input = screen.getByRole("textbox", { name: "Capture a task" });
    fireEvent.change(input, { target: { value: "First task" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "Next task" } });
    expect(posts()).toHaveLength(1);
    await act(async () => { resolve(reply()); });
    expect(input).toHaveValue("Next task");
    expect(screen.getByRole("button", { name: "Add to backlog" })).toBeEnabled();
  });

  it.each([
    { name: "Checklist step", button: "Add step", kind: "checklist" },
    { name: "Comment", button: "Post comment", kind: "comment" },
  ])("reuses an uncertain $kind ID without losing the draft", async ({ name, button, kind }) => {
    let fail = true;
    fetchMock.mockImplementation(async (_url, init) => {
      if (init?.method === "POST" && fail) throw new TypeError("Connection interrupted");
      return reply();
    });
    render(workspace(<ItemCollaboration resource={{ itemId: "task" }} />));
    await waitFor(() => expect(screen.queryByText("Loading shared details…")).not.toBeInTheDocument());
    const input = screen.getByRole("textbox", { name });
    fireEvent.change(input, { target: { value: "Bring snacks" } });
    fireEvent.click(screen.getByRole("button", { name: button }));
    await screen.findByRole("alert");
    expect(input).toHaveValue("Bring snacks");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: button }));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(posts()[0].kind).toBe(kind);
    expect(posts()[1].id).toBe(posts()[0].id);
  });
});


describe("task workspace search", () => {
  it("lets read-only members find tasks without deadlines and compose search without writes", async () => {
    const task: TaskRecord = { id: "backlog", text: "Pack school lunch", type: "task", responsibleMemberId: "other", deadline: null, isBacklog: true, planningDate: null, weekStartDate: "2026-10-12", isCompleted: false };
    fetchMock.mockResolvedValue(reply({ ...empty, tasks: [task,
      { ...task, id: "planned", text: "Order books", isBacklog: false, planningDate: "2026-10-12" },
      { ...task, id: "weekly", text: "Plan school trip", isBacklog: false },
      { ...task, id: "dated", text: "Return books", deadline: "2026-10-12" },
      { ...task, id: "done", text: "Pack supplies", isCompleted: true },
    ] }));
    render(workspace(<TaskWorkspaceDialog onClose={vi.fn()} />, "household", "reader", false));
    await screen.findByRole("button", { name: /Pack school lunch/ });
    fireEvent.click(screen.getByRole("button", { name: "No deadline" }));
    expect(screen.getByText("Open tasks without a deadline, whether planned or in the backlog.")).toBeVisible();
    for (const name of [/Pack school lunch/, /Order books/, /Plan school trip/]) {
      expect(screen.getByRole("button", { name })).toBeVisible();
    }
    expect(screen.queryByRole("button", { name: /Return books/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pack supplies/ })).not.toBeInTheDocument();
    const search = screen.getByRole("searchbox", { name: "Search tasks" });
    fireEvent.change(search, { target: { value: "  LUNCH  " } });
    expect(screen.getByRole("button", { name: /Pack school lunch/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Order books/ })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.getByRole("status")).toHaveTextContent("No tasks match your search in this view.");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("button", { name: "No deadline" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Order books/ })).toBeVisible();
    expect(posts()).toEqual([]);
  });

  it("explains an empty No deadline view", async () => {
    render(workspace(<TaskWorkspaceDialog onClose={vi.fn()} />));
    fireEvent.click(screen.getByRole("button", { name: "No deadline" }));
    expect(screen.getByRole("status")).toHaveTextContent("No open tasks without a deadline.");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("shows upcoming deadlines in both scheduled and backlog tasks without mutating them", async () => {
    const task: TaskRecord = { id: "today", text: "Pack school lunch", type: "task", responsibleMemberId: "other", deadline: "2026-10-12", isBacklog: true, planningDate: null, weekStartDate: "2026-10-12", isCompleted: false };
    fetchMock.mockResolvedValue(reply({ ...empty, tasks: [task,
      { ...task, id: "last", text: "Order school books", deadline: "2026-10-18", isBacklog: false, planningDate: "2026-10-20" },
      { ...task, id: "later", text: "Buy school shoes", deadline: "2026-10-19" },
      { ...task, id: "overdue", text: "Return library books", deadline: "2026-10-11" },
      { ...task, id: "undated", text: "Plan school trip", deadline: null },
      { ...task, id: "done", text: "Pack school supplies", isCompleted: true },
    ] }));
    render(workspace(<TaskWorkspaceDialog onClose={vi.fn()} />, "household", "reader", false));
    await screen.findByRole("button", { name: /Pack school lunch/ });
    fireEvent.click(screen.getByRole("button", { name: "Due soon" }));
    expect(screen.getByText("Open tasks due 2026-10-12 through 2026-10-18 (7 days).")).toBeVisible();
    expect(screen.getByRole("button", { name: /Pack school lunch/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Order school books/ })).toBeVisible();
    for (const name of [/Buy school shoes/, /Return library books/, /Plan school trip/, /Pack school supplies/]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    const search = screen.getByRole("searchbox", { name: "Search tasks" });
    fireEvent.change(search, { target: { value: "  LUNCH  " } });
    expect(screen.getByRole("button", { name: /Pack school lunch/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Order school books/ })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.getByRole("status")).toHaveTextContent("No tasks match your search in this view.");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("button", { name: "Due soon" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Order school books/ })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Overdue" }));
    expect(screen.getByRole("button", { name: /Return library books/ })).toBeVisible();
    expect(posts()).toEqual([]);
  });

  it("explains an empty Due soon view", async () => {
    render(workspace(<TaskWorkspaceDialog onClose={vi.fn()} />));
    fireEvent.click(screen.getByRole("button", { name: "Due soon" }));
    expect(screen.getByRole("status")).toHaveTextContent("No tasks due in the next 7 days.");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("combines text with completion filters and restores the selected view when cleared", async () => {
    const task: TaskRecord = { id: "open", text: "Pack school lunch", type: "task", responsibleMemberId: "user", deadline: null, isBacklog: true, planningDate: null, weekStartDate: "2026-10-12", isCompleted: false };
    fetchMock.mockResolvedValue(reply({ ...empty, tasks: [task, { ...task, id: "other", text: "Order books" }, { ...task, id: "done", text: "Pack school supplies", isCompleted: true }] }));
    render(workspace(<TaskWorkspaceDialog onClose={vi.fn()} />));
    await screen.findByRole("button", { name: /Pack school lunch/ });
    const search = screen.getByRole("searchbox", { name: "Search tasks" });
    fireEvent.change(search, { target: { value: "  SCHOOL  " } });
    expect(screen.queryByRole("button", { name: /Order books/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pack school supplies/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Completed" }));
    expect(screen.getByRole("button", { name: /Pack school supplies/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pack school lunch/ })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.getByRole("status")).toHaveTextContent("No tasks match your search in this view.");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
    expect(screen.getByRole("button", { name: "Completed" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Pack school supplies/ })).toBeInTheDocument();
  });
});


describe("task workspace sorting", () => {
  const task: TaskRecord = { id: "later", text: "Review Zulu", type: "task", responsibleMemberId: "user", deadline: "2026-10-13", isBacklog: true, planningDate: null, weekStartDate: "2026-10-12", isCompleted: false };
  const tasks = [task, { ...task, id: "earlier", text: "Review Alpha", deadline: "2026-10-12", isBacklog: false, planningDate: "2026-10-14" }, { ...task, id: "undated", text: "Review Beta", deadline: null, isBacklog: false }];
  const names = () => [...document.querySelectorAll(".workspace-task strong")].map(node => node.textContent);
  const chooseSort = (value: string) => fireEvent.change(screen.getByRole("combobox", { name: "Sort tasks" }), { target: { value } });

  it("sorts and restores the default order for a read-only member without writes", async () => {
    fetchMock.mockResolvedValue(reply({ ...empty, tasks }));
    render(workspace(<TaskWorkspaceDialog onClose={vi.fn()} />, "household", "reader", false));
    await screen.findByRole("button", { name: /Review Zulu/ });
    expect(names()).toEqual(["Review Zulu", "Review Alpha", "Review Beta"]);
    chooseSort("deadline");
    expect(names()).toEqual(["Review Alpha", "Review Zulu", "Review Beta"]);
    chooseSort("planned");
    expect(names()).toEqual(["Review Beta", "Review Alpha", "Review Zulu"]);
    chooseSort("name");
    chooseSort("name");
    expect(names()).toEqual(["Review Alpha", "Review Beta", "Review Zulu"]);
    fireEvent.click(screen.getByRole("button", { name: "No deadline" }));
    expect(names()).toEqual(["Review Beta"]);
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    chooseSort("default");
    expect(names()).toEqual(["Review Zulu", "Review Alpha", "Review Beta"]);
    expect(posts()).toEqual([]);
  });

  it("retains search, filter and sort after a failed edit, retry and returning to the list", async () => {
    const saved = tasks.map(t => ({ ...t }));
    let fail = true;
    fetchMock.mockImplementation(async (url, init) => {
      if (init?.method === "POST") {
        if (fail) throw new TypeError("Connection interrupted");
        const input = JSON.parse(init.body);
        Object.assign(saved.find(t => t.id === input.resource.itemId)!, { deadline: input.deadline });
        return reply();
      }
      const id = new URL(url, "http://local").searchParams.get("itemId");
      return reply(id ? { ...empty, task: saved.find(t => t.id === id)! } : { ...empty, tasks: saved });
    });
    render(workspace(<TaskWorkspaceDialog onClose={vi.fn()} />));
    await screen.findByRole("button", { name: /Review Alpha/ });
    fireEvent.click(screen.getByRole("button", { name: "Due soon" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search tasks" }), { target: { value: " REVIEW " } });
    chooseSort("deadline");
    expect(names()).toEqual(["Review Alpha", "Review Zulu"]);
    fireEvent.click(screen.getByRole("button", { name: /Review Alpha/ }));
    const deadline = await screen.findByLabelText("Must be done by");
    fireEvent.change(deadline, { target: { value: "2026-10-14" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection interrupted");
    fireEvent.click(screen.getByRole("button", { name: "← All tasks" }));
    await screen.findByRole("button", { name: /Review Alpha/ });
    expect(names()).toEqual(["Review Alpha", "Review Zulu"]);
    expect(screen.getByRole("combobox", { name: "Sort tasks" })).toHaveValue("deadline");
    fireEvent.click(screen.getByRole("button", { name: /Review Alpha/ }));
    fail = false;
    fireEvent.change(await screen.findByLabelText("Must be done by"), { target: { value: "2026-10-14" } });
    await waitFor(() => expect(screen.getByLabelText("Must be done by")).toHaveValue("2026-10-14"));
    fireEvent.click(screen.getByRole("button", { name: "← All tasks" }));
    await waitFor(() => expect(names()).toEqual(["Review Zulu", "Review Alpha"]));
    expect(screen.getByRole("searchbox", { name: "Search tasks" })).toHaveValue(" REVIEW ");
    expect(screen.getByRole("button", { name: "Due soon" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "Sort tasks" })).toHaveValue("deadline");
    expect(saved[1]).toMatchObject({ planningDate: "2026-10-14", isBacklog: false, isCompleted: false });
    expect(posts()).toHaveLength(2);
  });

  it.each([
    { scope: "household", householdId: "other-household", userId: "user" },
    { scope: "account", householdId: "household", userId: "other-user" },
  ])("resets the view and ignores an old refresh after changing $scope", async ({ householdId, userId }) => {
    let resolve!: (value: ReturnType<typeof reply>) => void;
    fetchMock.mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
    const { rerender } = render(workspace(<TaskWorkspaceDialog onClose={vi.fn()} />));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    chooseSort("name");
    fireEvent.click(screen.getByRole("button", { name: "Mine" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search tasks" }), { target: { value: "old" } });
    fetchMock.mockResolvedValue(reply({ ...empty, tasks: [{ ...task, id: "new", text: "New household task" }] }));
    rerender(workspace(<TaskWorkspaceDialog onClose={vi.fn()} />, householdId, userId));
    await screen.findByRole("button", { name: /New household task/ });
    await act(async () => { resolve(reply({ ...empty, tasks })); });
    expect(names()).toEqual(["New household task"]);
    expect(screen.getByRole("combobox", { name: "Sort tasks" })).toHaveValue("default");
    expect(screen.getByRole("searchbox", { name: "Search tasks" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(posts()).toEqual([]);
  });
});

describe("quick task deadlines", () => {
  const task: TaskRecord = { id: "deadline-task", text: "Pack", type: "task", responsibleMemberId: null, deadline: null, isBacklog: true, planningDate: null, weekStartDate: "2026-10-12", isCompleted: false };

  it("saves household Today and Tomorrow without changing placement and retains the date after a failed save", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T04:30:00Z"));
    let saved = { ...task };
    let fail = false;
    fetchMock.mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        if (fail) throw new Error("Please retry");
        saved = { ...saved, deadline: JSON.parse(init.body).deadline };
      }
      return reply({ ...empty, task: saved });
    });
    render(workspace(<ItemCollaboration resource={{ itemId: task.id }} />));
    const today = await screen.findByRole("button", { name: "Set deadline to today" });
    fireEvent.click(today);
    await waitFor(() => expect(screen.getByLabelText("Must be done by")).toHaveValue("2026-11-01"));
    expect(posts()[0]).toEqual({ action: "task", resource: { itemId: task.id }, deadline: "2026-11-01" });
    fail = true;
    fireEvent.click(screen.getByRole("button", { name: "Set deadline to tomorrow" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Must be done by")).toHaveValue("2026-11-01");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Set deadline to tomorrow" }));
    await waitFor(() => expect(screen.getByLabelText("Must be done by")).toHaveValue("2026-11-02"));
    expect(posts()[2]).toEqual({ action: "task", resource: { itemId: task.id }, deadline: "2026-11-02" });
  });

  it("keeps quick deadlines unavailable to read-only members", async () => {
    fetchMock.mockResolvedValue(reply({ ...empty, task }));
    render(workspace(<ItemCollaboration resource={{ itemId: task.id }} />, "household", "reader", false));
    expect(await screen.findByRole("button", { name: "Set deadline to today" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Set deadline to tomorrow" })).toBeDisabled();
  });
});

describe("quick task planning", () => {
  const task: TaskRecord = { id: "plan-task", text: "Pack lunch", type: "task", responsibleMemberId: "user", deadline: "2026-11-05", isBacklog: true, planningDate: null, weekStartDate: "2026-10-12", isCompleted: false };

  it("plans today and tomorrow independently of the selected week and preserves drafts on a failed retry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T00:30:00Z"));
    let saved = { ...task };
    let reject: ((error: Error) => void) | undefined;
    let fail = true;
    fetchMock.mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        if (fail) return new Promise((_resolve, no) => { reject = no; });
        const fields = JSON.parse(init.body);
        saved = { ...saved, isBacklog: fields.isBacklog, planningDate: fields.planningDate };
      }
      return reply({ ...empty, task: saved });
    });
    render(workspace(<ItemCollaboration resource={{ itemId: task.id }} />));
    const today = await screen.findByRole("button", { name: "Plan today" });
    fireEvent.change(screen.getByRole("textbox", { name: "Task name" }), { target: { value: "Keep this name draft" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), { target: { value: "Keep this comment" } });
    fireEvent.click(today);
    fireEvent.click(today);
    expect(posts()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Plan tomorrow" })).toBeDisabled();
    await act(async () => { reject!(new Error("Please retry")); });
    expect(screen.getByRole("alert")).toHaveTextContent("Please retry");
    expect(screen.getByLabelText("Placement")).toHaveValue("backlog");
    expect(screen.getByRole("textbox", { name: "Task name" })).toHaveValue("Keep this name draft");
    expect(screen.getByRole("textbox", { name: "Comment" })).toHaveValue("Keep this comment");
    fail = false;
    fireEvent.click(today);
    await waitFor(() => expect(screen.getByLabelText("Plan to do on")).toHaveValue("2026-11-01"));
    expect(posts()[1]).toEqual(posts()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Plan tomorrow" }));
    await waitFor(() => expect(screen.getByLabelText("Plan to do on")).toHaveValue("2026-11-02"));
    expect(posts()[2]).toEqual({ action: "task", resource: { itemId: task.id }, isBacklog: false, planningDate: "2026-11-02" });
    expect(saved).toMatchObject({ deadline: task.deadline, responsibleMemberId: task.responsibleMemberId, isCompleted: false });
    expect(screen.getByRole("textbox", { name: "Comment" })).toHaveValue("Keep this comment");
  });

  it("disables planning for read-only members", async () => {
    fetchMock.mockResolvedValue(reply({ ...empty, task }));
    render(workspace(<ItemCollaboration resource={{ itemId: task.id }} />, "household", "reader", false));
    expect(await screen.findByRole("button", { name: "Plan today" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Plan tomorrow" })).toBeDisabled();
    expect(posts()).toEqual([]);
  });

  it.each([{ isCompleted: true, includePlacement: true }, { isCompleted: false, includePlacement: false }])("omits shortcuts when planning is unavailable: %j", async ({ isCompleted, includePlacement }) => {
    fetchMock.mockResolvedValue(reply({ ...empty, task: { ...task, isCompleted } }));
    render(workspace(<ItemCollaboration resource={{ itemId: task.id }} includePlacement={includePlacement} />));
    await screen.findByLabelText("Must be done by");
    expect(screen.queryByRole("button", { name: "Plan today" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Plan tomorrow" })).not.toBeInTheDocument();
  });
});

describe("list completion", () => {
  const task: TaskRecord = { id: "task", text: "Pack lunch", type: "task", responsibleMemberId: "user", deadline: "2026-10-12", isBacklog: true, planningDate: null, weekStartDate: "2026-10-12", isCompleted: false };
  it("completes and reopens without opening details or losing search, sort and filter", async () => {
    let current = { ...task };
    fetchMock.mockImplementation(async (_url, init) => {
      if (init?.method === "POST") current = { ...current, isCompleted: JSON.parse(init.body).isCompleted };
      return reply({ ...empty, tasks: [current] });
    });
    render(workspace(<TaskWorkspaceDialog onClose={vi.fn()} />));
    await screen.findByRole("button", { name: "Complete" });
    fireEvent.click(screen.getByRole("button", { name: "Due today" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "lunch" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort tasks" }), { target: { value: "name" } });
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Pack lunch/ })).not.toBeInTheDocument());
    expect(posts()).toEqual([{ action: "task", resource: { itemId: "task" }, isCompleted: true }]);
    expect(screen.getByRole("searchbox")).toHaveValue("lunch");
    expect(screen.getByRole("combobox", { name: "Sort tasks" })).toHaveValue("name");
    expect(screen.getByRole("button", { name: "Due today" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Completed" }));
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument());
    expect(posts()[1].isCompleted).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Due today" }));
    fireEvent.click(screen.getByRole("button", { name: /Pack lunch/ }));
    expect(screen.getByRole("button", { name: "← All tasks" })).toBeVisible();
  });
  it("blocks overlapping clicks and preserves the row on a failed save for an idempotent retry", async () => {
    let reject!: (error: Error) => void;
    fetchMock.mockImplementation(async (_url, init) => init?.method === "POST"
      ? new Promise((_resolve, no) => { reject = no; })
      : reply({ ...empty, tasks: [task] }));
    render(workspace(<TaskWorkspaceDialog onClose={vi.fn()} />));
    const complete = await screen.findByRole("button", { name: "Complete" });
    fireEvent.click(complete); fireEvent.click(complete);
    expect(posts()).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Pack lunch/ })).toBeDisabled();
    await act(async () => { reject(new Error("Connection interrupted")); });
    expect(screen.getByRole("alert")).toHaveTextContent("Connection interrupted");
    expect(screen.getByRole("button", { name: /Pack lunch/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    expect(posts()[1]).toEqual(posts()[0]);
    await act(async () => { reject(new Error("Still offline")); });
  });
  it("keeps completion unavailable to readers", async () => {
    fetchMock.mockResolvedValue(reply({ ...empty, tasks: [task] }));
    render(workspace(<TaskWorkspaceDialog onClose={vi.fn()} />, "household", "reader", false));
    await screen.findByRole("button", { name: /Pack lunch/ });
    expect(screen.queryByRole("button", { name: "Complete" })).not.toBeInTheDocument();
    expect(posts()).toEqual([]);
  });
});

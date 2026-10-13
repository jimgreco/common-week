import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemCollaboration, TaskWorkspaceDialog, TaskWorkspaceProvider } from "./task-workspace";
import type { TaskWorkspaceData } from "@/lib/task-workspace";

vi.mock("./dialogs", () => ({ Modal: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

const empty: TaskWorkspaceData = { tasks: [], entries: [], task: null };
const reply = (data = empty) => ({ json: async () => ({ ok: true, data }) });
const fetchMock = vi.fn();
const changes = vi.fn();
function workspace(children: ReactNode, householdId = "household", userId = "user") {
  return <TaskWorkspaceProvider householdId={householdId} people={[]} userId={userId} canEdit week="2026-10-12" today="2026-10-12" isDemo={false} tasks={[]} onChange={changes}>{children}</TaskWorkspaceProvider>;
}
function posts() { return fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init.body)); }

beforeEach(() => { fetchMock.mockReset().mockResolvedValue(reply()); changes.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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

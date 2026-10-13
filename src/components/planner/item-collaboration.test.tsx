import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemCollaboration, TaskWorkspaceDialog, TaskWorkspaceProvider } from "./task-workspace";
import type { TaskWorkspaceData } from "@/lib/task-workspace";

vi.mock("./dialogs", () => ({ Modal: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
const fetchMock = vi.fn();
const empty: TaskWorkspaceData = { tasks: [], entries: [], task: null };
const reply = (data = empty) => ({ json: async () => ({ ok: true, data }) });
function details(itemId: string) {
  return <TaskWorkspaceProvider householdId="household" people={[]} userId="user" canEdit week="2026-10-12" today="2026-10-12" isDemo={false} tasks={[]} onChange={vi.fn()}><ItemCollaboration resource={{ itemId }} /></TaskWorkspaceProvider>;
}
function checklist(text: string): TaskWorkspaceData {
  return { ...empty, entries: [{ id: text, text, kind: "checklist", completed: false, createdBy: "user", author: "You", createdAt: "2026-10-12T12:00:00Z" }] };
}
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("shared detail loading", () => {
  it("keeps a late response for the old item out of the newly selected item", async () => {
    let finishOld!: (value: ReturnType<typeof reply>) => void;
    fetchMock.mockImplementation((url: string) => url.includes("itemId=old") ? new Promise((yes) => { finishOld = yes; }) : Promise.resolve(reply(checklist("New task step"))));
    const { rerender } = render(details("old"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), { target: { value: "Old task draft" } });
    rerender(details("new"));
    expect(screen.getByRole("textbox", { name: "Comment" })).toHaveValue("");
    await screen.findByText("New task step");
    await act(async () => { finishOld(reply(checklist("Old task step"))); });
    expect(screen.getByText("New task step")).toBeVisible();
    expect(screen.queryByText("Old task step")).not.toBeInTheDocument();
  });

  it("clears previously loaded details immediately when changing items", async () => {
    fetchMock.mockResolvedValueOnce(reply(checklist("Old task step"))).mockImplementation(() => new Promise(() => {}));
    const { rerender } = render(details("old"));
    await screen.findByText("Old task step");
    rerender(details("new"));
    expect(screen.queryByText("Old task step")).not.toBeInTheDocument();
    expect(screen.getByText("Loading shared details…")).toBeVisible();
  });

  it("recovers from an initial load failure without reopening the editor", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Connection interrupted")).mockResolvedValue(reply(checklist("Recovered step")));
    render(details("task"));
    fireEvent.click(await screen.findByRole("button", { name: "Retry loading shared details" }));
    await screen.findByText("Recovered step");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry loading shared details" })).not.toBeInTheDocument();
  });

  it("does not let the initial load replace the refreshed list after capture", async () => {
    let finishInitial!: (value: ReturnType<typeof reply>) => void;
    let loads = 0;
    const task = { id: "captured", text: "Just saved", type: "task" as const, responsibleMemberId: null, deadline: null, isBacklog: true, planningDate: null, weekStartDate: "2026-10-12", isCompleted: false };
    fetchMock.mockImplementation((_url, init) => {
      if (init?.method === "POST") return Promise.resolve(reply());
      if (++loads === 1) return new Promise((yes) => { finishInitial = yes; });
      return Promise.resolve(reply({ ...empty, tasks: [task] }));
    });
    render(<TaskWorkspaceProvider householdId="household" people={[]} userId="user" canEdit week="2026-10-12" today="2026-10-12" isDemo={false} tasks={[]} onChange={vi.fn()}><TaskWorkspaceDialog onClose={vi.fn()} /></TaskWorkspaceProvider>);
    await waitFor(() => expect(loads).toBe(1));
    fireEvent.change(screen.getByRole("textbox", { name: "Capture a task" }), { target: { value: task.text } });
    fireEvent.click(screen.getByRole("button", { name: "Add to backlog" }));
    await screen.findByText(task.text);
    await act(async () => { finishInitial(reply()); });
    expect(screen.getByText(task.text)).toBeVisible();
  });
});

import { describe, expect, it } from "vitest";
import {
  taskMatchesFilter,
  workspaceMutationSchema,
  WorkspaceCreateAttempts,
  type WorkspaceMutation,
  type TaskRecord,
} from "./task-workspace";
const task: TaskRecord = {
  id: "task",
  text: "Pack",
  type: "task",
  responsibleMemberId: "adult",
  deadline: "2026-09-11",
  isBacklog: true,
  planningDate: null,
  weekStartDate: "2026-09-07",
  isCompleted: false,
};
describe("task workspace", () => {
  it("keeps file retries stable while distinguishing item and file contents", () => {
    const attempts = new WorkspaceCreateAttempts();
    const input: WorkspaceMutation = { action: "add", resource: { itemId: "task-a" }, id: "first", kind: "file", text: "notes.txt", fileData: "YQ==" };
    expect(attempts.prepare({ ...input, id: "retry" }).id).toBe("retry");
    const retry = attempts.prepare(input);
    expect(retry.id).toBe("retry");
    expect(attempts.prepare({ ...input, id: "other-file", fileData: "Yg==" }).id).toBe("other-file");
    expect(attempts.prepare({ ...input, id: "other-task", resource: { itemId: "task-b" } }).id).toBe("other-task");
    attempts.complete(retry);
    expect(attempts.prepare({ ...input, id: "intentional-new-file" }).id).toBe("intentional-new-file");
  });

  it("searches task text within the chosen filter without changing completion or responsibility scope", () => {
    const packing = { ...task, text: "Pack school lunches" };
    expect(taskMatchesFilter(packing, "Backlog", "adult", "2026-09-12", "  SCHOOL  ")).toBe(true);
    expect(taskMatchesFilter(packing, "All", "adult", "2026-09-12", "   ")).toBe(true);
    expect(taskMatchesFilter(packing, "All", "adult", "2026-09-12", "school shoes")).toBe(false);
    expect(taskMatchesFilter(packing, "Mine", "other", "2026-09-12", "school")).toBe(false);
    expect(taskMatchesFilter({ ...packing, isCompleted: true }, "All", "adult", "2026-09-12", "school")).toBe(false);
    expect(taskMatchesFilter({ ...packing, isCompleted: true }, "Completed", "adult", "2026-09-12", "school")).toBe(true);
    expect(taskMatchesFilter({ ...packing, isCompleted: true }, "Completed", "adult", "2026-09-12", "shoes")).toBe(false);
  });

  it("separates responsibility, backlog, and deadline views", () => {
    expect(taskMatchesFilter(task, "Mine", "adult", "2026-09-12")).toBe(true);
    expect(taskMatchesFilter(task, "Mine", "other", "2026-09-12")).toBe(false);
    expect(taskMatchesFilter(task, "Backlog", "other", "2026-09-12")).toBe(
      true,
    );
    expect(taskMatchesFilter(task, "Unassigned", "adult", "2026-09-12")).toBe(
      false,
    );
    expect(taskMatchesFilter(task, "Overdue", "adult", "2026-09-11")).toBe(
      false,
    );
    expect(taskMatchesFilter(task, "Overdue", "adult", "2026-09-12")).toBe(
      true,
    );
    expect(
      taskMatchesFilter(
        { ...task, isCompleted: true },
        "Overdue",
        "adult",
        "2026-09-12",
      ),
    ).toBe(false);
  });
  it("preserves explicit deadline and assignment clears and rejects invalid dates", () => {
    const input = {
      action: "task",
      resource: { itemId: "b0dadb97-9b91-498c-8667-3ac19887c751" },
      deadline: null,
      responsibleMemberId: null,
    };
    expect(workspaceMutationSchema.parse(input)).toEqual(input);
    expect(
      workspaceMutationSchema.safeParse({ ...input, deadline: "2026-02-30" })
        .success,
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  taskMatchesFilter,
  workspaceMutationSchema,
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

import { describe, expect, it } from "vitest";
import {
  taskMatchesFilter,
  taskDeadlineDate,
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
  it.each([
    { now: "2026-03-09T00:30:00Z", zone: "America/New_York", today: "2026-03-08", last: "2026-03-14", before: "2026-03-07", after: "2026-03-15" },
    { now: "2026-11-01T04:30:00Z", zone: "America/New_York", today: "2026-11-01", last: "2026-11-07", before: "2026-10-31", after: "2026-11-08" },
    { now: "2026-12-31T12:00:00Z", zone: "Pacific/Auckland", today: "2027-01-01", last: "2027-01-07", before: "2026-12-31", after: "2027-01-08" },
  ])("limits Due soon to seven household calendar days from $today", ({ now, zone, today, last, before, after }) => {
    const householdToday = taskDeadlineDate(0, zone, new Date(now));
    expect(householdToday).toBe(today);
    for (const deadline of [today, last]) {
      expect(taskMatchesFilter({ ...task, deadline }, "Due soon", "adult", householdToday)).toBe(true);
      expect(taskMatchesFilter({ ...task, deadline, isBacklog: false, planningDate: before }, "Due soon", "adult", householdToday)).toBe(true);
    }
    for (const deadline of [before, after, null]) {
      expect(taskMatchesFilter({ ...task, deadline }, "Due soon", "adult", householdToday)).toBe(false);
    }
    expect(taskMatchesFilter({ ...task, deadline: today, isCompleted: true }, "Due soon", "adult", householdToday)).toBe(false);
    expect(taskMatchesFilter({ ...task, deadline: today }, "Due soon", "adult", householdToday, "missing")).toBe(false);
    expect(taskMatchesFilter({ ...task, deadline: before }, "Overdue", "adult", householdToday)).toBe(true);
  });

  it("uses the household date for shortcuts across UTC and DST boundaries", () => {
    const midnightUTC = new Date("2026-03-09T00:30:00Z");
    expect(taskDeadlineDate(0, "America/New_York", midnightUTC)).toBe("2026-03-08");
    expect(taskDeadlineDate(1, "America/New_York", midnightUTC)).toBe("2026-03-09");
    const fallBack = new Date("2026-11-01T04:30:00Z");
    expect(taskDeadlineDate(1, "America/New_York", fallBack)).toBe("2026-11-02");
    expect(taskDeadlineDate(1, "Pacific/Auckland", new Date("2026-12-31T01:00:00Z"))).toBe("2027-01-01");
  });

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

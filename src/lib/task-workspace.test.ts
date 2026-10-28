import { describe, expect, it } from "vitest";
import {
  taskMatchesFilter,
  taskDeadlineDate,
  taskPlanningFields,
  sortWorkspaceTasks,
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

describe("quick task planning", () => {
  it.each([
    ["2026-11-02T00:30:00Z", "America/New_York", "2026-11-01", "2026-11-02"],
    ["2026-03-08T06:30:00Z", "America/New_York", "2026-03-08", "2026-03-09"],
    ["2026-12-31T11:30:00Z", "Pacific/Auckland", "2027-01-01", "2027-01-02"],
  ])("plans a household calendar day across boundaries at %s", (instant, zone, today, tomorrow) => {
    for (const [days, date] of [[0, today], [1, tomorrow]] as const) {
      const fields = taskPlanningFields(days, zone, new Date(instant));
      expect(fields).toEqual({ isBacklog: false, planningDate: date });
      expect({ ...task, ...fields }).toMatchObject({ deadline: task.deadline, responsibleMemberId: task.responsibleMemberId, isCompleted: false });
    }
  });
});
describe("task workspace sorting", () => {
  const tasks: TaskRecord[] = [
    { ...task, id: "later", text: "Review 10", deadline: "2026-11-01", isBacklog: false, planningDate: "2026-11-03", weekStartDate: "2026-11-02" },
    { ...task, id: "undated", text: "Review 2", deadline: null },
    { ...task, id: "weekly", text: "Weekly plan", deadline: "2026-10-31", isBacklog: false, planningDate: null, weekStartDate: "2026-10-26" },
    { ...task, id: "earlier", text: "Earlier plan", deadline: "2026-10-30", isBacklog: false, planningDate: "2026-10-27", weekStartDate: "2026-10-26" },
  ];
  const ids = (records: TaskRecord[]) => records.map(({ id }) => id);

  it("keeps the exact default order and never changes the input", () => {
    const before = structuredClone(tasks);
    expect(ids(sortWorkspaceTasks(tasks, "default"))).toEqual(ids(tasks));
    for (const sort of ["deadline", "planned", "name", "default"] as const) sortWorkspaceTasks(tasks, sort);
    expect(tasks).toEqual(before);
  });

  it("sorts deadlines ascending with undated tasks last, independently of planned dates", () => {
    expect(ids(sortWorkspaceTasks(tasks, "deadline"))).toEqual(["earlier", "weekly", "later", "undated"]);
    expect(sortWorkspaceTasks([{ ...task, id: "a", deadline: "2026-12-31" }, { ...task, id: "b", deadline: "2027-01-01" }], "deadline").map(t => t.deadline)).toEqual(["2026-12-31", "2027-01-01"]);
  });

  it("sorts whole-week tasks by week start and puts backlog last even when stale placement exists", () => {
    expect(ids(sortWorkspaceTasks(tasks, "planned"))).toEqual(["weekly", "earlier", "later", "undated"]);
    const backlog = { ...tasks[1], planningDate: "2000-01-01", weekStartDate: "2000-01-01" };
    expect(ids(sortWorkspaceTasks([backlog, tasks[0]], "planned"))).toEqual(["later", "undated"]);
    expect(backlog.planningDate).toBe("2000-01-01");
  });

  it("uses natural case-insensitive names and stable IDs to resolve equivalent names", () => {
    const sameNames = [
      { ...task, id: "z", text: " École 2 " },
      { ...task, id: "b", text: "ecole 10" },
      { ...task, id: "a", text: "ecole 2" },
    ];
    for (const sort of ["name", "deadline", "planned"] as const) {
      expect(ids(sortWorkspaceTasks(sameNames, sort))).toEqual(["a", "z", "b"]);
      expect(ids(sortWorkspaceTasks([...sameNames].reverse(), sort))).toEqual(["a", "z", "b"]);
    }
  });

  it("composes with filters and updates from edits without changing stored dates or completion", () => {
    const records = tasks.map(t => ({ ...t }));
    records[0].deadline = null;
    records[2].isCompleted = true;
    const visible = records.filter(t => taskMatchesFilter(t, "No deadline", "adult", "2026-10-23", " REVIEW "));
    expect(ids(sortWorkspaceTasks(visible, "name"))).toEqual(["undated", "later"]);
    expect(ids(sortWorkspaceTasks(visible, "planned"))).toEqual(["later", "undated"]);
    expect(records[0].deadline).toBeNull();
    expect(records[2].isCompleted).toBe(true);
  });
});

describe("task workspace", () => {
  it.each([
    { isBacklog: true, planningDate: null },
    { isBacklog: false, planningDate: "2026-10-22" },
    { isBacklog: false, planningDate: null },
  ])("finds open tasks without deadlines regardless of placement: %j", (placement) => {
    const undated = { ...task, ...placement, deadline: null };
    expect(taskMatchesFilter(undated, "No deadline", "other", "2026-10-22", " PACK ")).toBe(true);
    expect(taskMatchesFilter(undated, "No deadline", "other", "2026-10-22", "missing")).toBe(false);
    expect(taskMatchesFilter({ ...undated, isCompleted: true }, "No deadline", "adult", "2026-10-22")).toBe(false);
    for (const deadline of ["2026-10-21", "2026-10-22", "2026-10-23"]) {
      expect(taskMatchesFilter({ ...undated, deadline }, "No deadline", "adult", "2026-10-22")).toBe(false);
    }
    expect(taskMatchesFilter(undated, "No deadline", "adult", "2026-10-22")).toBe(true);
    expect(undated).toEqual({ ...task, ...placement, deadline: null });
  });

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


describe("Due today", () => {
  it.each([
    ["2026-11-02T00:30:00Z", "America/New_York", "2026-11-01"],
    ["2026-12-31T12:00:00Z", "Pacific/Auckland", "2027-01-01"],
  ])("uses household today at %s in %s independently of planned week", (instant, zone, expected) => {
    const today = taskDeadlineDate(0, zone, new Date(instant));
    expect(today).toBe(expected);
    for (const isBacklog of [true, false]) {
      const due = { ...task, deadline: today, isBacklog, planningDate: "2000-01-01" };
      expect(taskMatchesFilter(due, "Due today", "other", today, "  PACK ")).toBe(true);
      expect(taskMatchesFilter(due, "Due today", "other", today, "missing")).toBe(false);
      expect(taskMatchesFilter({ ...due, isCompleted: true }, "Due today", "adult", today)).toBe(false);
      for (const deadline of [null, "2000-01-01", "2099-01-01"]) {
        expect(taskMatchesFilter({ ...due, deadline }, "Due today", "adult", today)).toBe(false);
      }
    }
  });
});

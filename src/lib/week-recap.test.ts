import { describe, expect, it } from "vitest";
import { buildWeekRecap, weekRecapSentence, type RecapItem } from "@/lib/week-recap";

const task = (values: Partial<RecapItem> & Pick<RecapItem, "id">): RecapItem => ({
  text: values.id, type: "task", isCompleted: false, planningDate: null, weekStartDate: "2026-10-26", assignedMemberIds: null, childId: null, ...values,
});
const people = [{ id: "adult-a", name: "Sam" }, { id: "child-1", name: "Ivy", color: "#f00" }, { id: "adult-b", name: "Alex" }];

describe("buildWeekRecap", () => {
  it("summarizes the week before the planned week", () => {
    const recap = buildWeekRecap("2026-11-02", [
      task({ id: "done-sam-tue", isCompleted: true, planningDate: "2026-10-27", assignedMemberIds: ["adult-a"] }),
      task({ id: "done-sam-tue-2", isCompleted: true, planningDate: "2026-10-27", responsibleMemberId: "adult-a" }),
      task({ id: "done-ivy", isCompleted: true, planningDate: "2026-10-29", childId: "child-1" }),
      task({ id: "done-shared", isCompleted: true }),
      task({ id: "open-in-week", planningDate: "2026-10-30", assignedMemberIds: ["adult-a"] }),
      task({ id: "carried", weekStartDate: "2026-11-02", originalWeekStartDate: "2026-10-26" }),
      task({ id: "new-next-week", weekStartDate: "2026-11-02", originalWeekStartDate: "2026-11-02" }),
      task({ id: "backlog", isBacklog: true, isCompleted: true }),
      task({ id: "note", type: "note", isCompleted: true }),
    ], people);
    expect(recap.weekStart).toBe("2026-10-26");
    expect(recap.completedCount).toBe(4);
    expect(recap.unfinishedCount).toBe(2);
    expect(recap.sharedCompletedCount).toBe(1);
    expect(recap.people).toEqual([
      { id: "adult-a", name: "Sam", color: null, completedCount: 2, busiestDay: "2026-10-27", busiestDayCount: 2 },
      { id: "child-1", name: "Ivy", color: "#f00", completedCount: 1, busiestDay: "2026-10-29", busiestDayCount: 1 },
    ]);
  });

  it("limits highlights and handles an empty week", () => {
    const many = Array.from({ length: 7 }, (_, index) => task({ id: `t${index}`, isCompleted: true }));
    expect(buildWeekRecap("2026-11-02", many, people).highlights).toHaveLength(5);
    const empty = buildWeekRecap("2026-11-02", [], people);
    expect(empty).toMatchObject({ completedCount: 0, unfinishedCount: 0, people: [] });
    expect(weekRecapSentence(empty)).toBe("no shared tasks.");
  });

  it("describes the week in one sentence", () => {
    expect(weekRecapSentence({ weekStart: "2026-10-26", completedCount: 1, unfinishedCount: 0, sharedCompletedCount: 0, highlights: [], people: [] })).toBe("1 shared task done, nothing left open.");
    expect(weekRecapSentence({ weekStart: "2026-10-26", completedCount: 3, unfinishedCount: 2, sharedCompletedCount: 0, highlights: [], people: [] })).toBe("3 shared tasks done, 2 still open.");
  });
});

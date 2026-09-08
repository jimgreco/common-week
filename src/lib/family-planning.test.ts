import { describe, expect, it } from "vitest";
import { familyMutationSchema, familyWeekSchema, routineOccurrencesForWeek, validFamilyDate } from "@/lib/family-planning";
import type { TaskRoutine } from "@/types/domain";
const routine: TaskRoutine = { id: "00000000-0000-4000-8000-000000000001", text: "School bag", childId: null,
  frequency: "daily", interval: 1, weekdays: [], startsOn: "2026-09-07", endsOn: null, active: true };

describe("routine occurrence expansion", () => {
  it("expands only the seven selected days, including DST weeks", () => {
    const dates = routineOccurrencesForWeek(routine, "2026-11-02");
    expect(dates).toHaveLength(7);
    expect(dates[6].planningDate).toBe("2026-11-08");
  });
  it("restricts daily routines to school days and includes date boundaries", () => {
    expect(routineOccurrencesForWeek({ ...routine, weekdays: [0,1,2,3,4], startsOn: "2026-09-09", endsOn: "2026-09-11" }, "2026-09-07").map((o) => o.planningDate))
      .toEqual(["2026-09-09", "2026-09-10", "2026-09-11"]);
  });
  it("anchors daily intervals to the start date across week/year boundaries", () => {
    expect(routineOccurrencesForWeek({ ...routine, startsOn: "2026-12-30", interval: 3 }, "2027-01-04").map((o) => o.planningDate))
      .toEqual(["2027-01-05", "2027-01-08"]);
  });
  it("anchors alternating weekly chores to their original Monday", () => {
    const alternate = { ...routine, frequency: "weekly" as const, interval: 2, weekdays: [3] };
    expect(routineOccurrencesForWeek(alternate,"2026-09-07")).toEqual([{ occurrenceDate: "2026-09-10", planningDate: "2026-09-10" }]);
    expect(routineOccurrencesForWeek(alternate,"2026-09-14")).toEqual([]);
    expect(routineOccurrencesForWeek(alternate,"2026-09-21")[0].planningDate).toBe("2026-09-24");
  });
  it("gives undated weekly chores a stable week occurrence key", () => {
    expect(routineOccurrencesForWeek({ ...routine, frequency: "weekly", startsOn: "2026-09-10" },"2026-09-07"))
      .toEqual([{ occurrenceDate:"2026-09-07", planningDate:null }]);
  });
  it("does not generate paused, not-yet-started or ended routines", () => {
    expect(routineOccurrencesForWeek({ ...routine, active:false },"2026-09-07")).toEqual([]);
    expect(routineOccurrencesForWeek(routine,"2026-08-31")).toEqual([]);
    expect(routineOccurrencesForWeek({ ...routine, endsOn:"2026-09-13" },"2026-09-14")).toEqual([]);
  });
});

describe("family input boundaries", () => {
  it("rejects nonexistent dates and non-Monday weeks", () => {
    expect(validFamilyDate("2026-02-30")).toBe(false);
    expect(validFamilyDate("2028-02-29")).toBe(true);
    expect(familyWeekSchema.safeParse("2026-09-08").success).toBe(false);
  });
  it("normalizes Swift omitted optional fields and duplicate weekdays", () => {
    const parsed = familyMutationSchema.parse({ action:"saveRoutine",weekStart:"2026-09-07",routine:{ ...routine,childId:undefined,endsOn:undefined,weekdays:[4,0,4] } });
    expect(parsed.action === "saveRoutine" && parsed.routine).toMatchObject({ childId:null,endsOn:null,weekdays:[0,4] });
  });
  it("rejects unbounded recurrence, malformed colors, backwards end dates, and stale negative revisions", () => {
    expect(familyMutationSchema.safeParse({ action:"saveRoutine",weekStart:"2026-09-07",routine:{ ...routine, interval:0 } }).success).toBe(false);
    expect(familyMutationSchema.safeParse({ action:"saveRoutine",weekStart:"2026-09-07",routine:{ ...routine, endsOn:"2026-09-01" } }).success).toBe(false);
    expect(familyMutationSchema.safeParse({ action:"saveChild",weekStart:"2026-09-07",child:{name:"Ada",color:"red",calendarPreferenceIds:[]} }).success).toBe(false);
    expect(familyMutationSchema.safeParse({ action:"saveReview",weekStart:"2026-09-07",priorities:"",meals:"",logistics:"",revision:-1 }).success).toBe(false);
  });
});

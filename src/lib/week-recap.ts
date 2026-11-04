import { familyDateOffset } from "@/lib/family-planning";
import { itemMemberIds } from "@/lib/household-assignments";
import type { PlanningItem, WeekRecap } from "@/types/domain";

export type RecapItem = Pick<PlanningItem, "id" | "text" | "type" | "isCompleted" | "planningDate" | "weekStartDate" | "assignedMemberIds" | "childId" | "responsibleMemberId" | "isBacklog"> & {
  originalWeekStartDate?: string;
};

export interface RecapPerson { id: string; name: string; color?: string | null }

/**
 * Summarizes the week before `weekStart` from shared tasks only. Completed
 * tasks stay in the week they were finished; unfinished tasks are either still
 * in that week or were carried into a later one. Calendar events are not read.
 */
export function buildWeekRecap(weekStart: string, items: RecapItem[], people: RecapPerson[]): WeekRecap {
  const recapWeek = familyDateOffset(weekStart, -7);
  const tasks = items.filter((item) => item.type === "task" && !item.isBacklog);
  const completed = tasks.filter((item) => item.weekStartDate === recapWeek && item.isCompleted);
  const unfinished = tasks.filter((item) => !(item.weekStartDate === recapWeek && item.isCompleted)
    && (item.weekStartDate === recapWeek
      ? !item.isCompleted
      : item.weekStartDate > recapWeek && (item.originalWeekStartDate ?? item.weekStartDate) <= recapWeek));
  const owners = (item: RecapItem) => [...new Set([...itemMemberIds(item as PlanningItem), ...(item.responsibleMemberId ? [item.responsibleMemberId] : [])])];
  const recapPeople = people.map((person) => {
    const done = completed.filter((item) => owners(item).includes(person.id));
    const dated = [...completed, ...unfinished.filter((item) => item.weekStartDate === recapWeek)]
      .filter((item) => item.planningDate && owners(item).includes(person.id));
    const perDay = new Map<string, number>();
    for (const item of dated) perDay.set(item.planningDate!, (perDay.get(item.planningDate!) ?? 0) + 1);
    const [busiestDay, busiestDayCount] = [...perDay.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [null, 0];
    return { id: person.id, name: person.name, color: person.color ?? null, completedCount: done.length, busiestDay, busiestDayCount };
  }).filter((person) => person.completedCount > 0 || person.busiestDay);
  return {
    weekStart: recapWeek,
    completedCount: completed.length,
    unfinishedCount: unfinished.length,
    sharedCompletedCount: completed.filter((item) => !owners(item).length).length,
    highlights: completed.slice(0, 5).map((item) => ({ id: item.id, text: item.text })),
    people: recapPeople,
  };
}

export function weekRecapSentence(recap: WeekRecap): string {
  if (!recap.completedCount && !recap.unfinishedCount) return "no shared tasks.";
  const done = `${recap.completedCount} shared task${recap.completedCount === 1 ? "" : "s"} done`;
  return recap.unfinishedCount ? `${done}, ${recap.unfinishedCount} still open.` : `${done}, nothing left open.`;
}

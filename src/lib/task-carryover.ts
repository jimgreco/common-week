import { currentWeekStart, parseDateOnly, todayInTimeZone } from "@/lib/date";
import type { PlanningItem } from "@/types/domain";

export interface TaskCarryoverContext {
  today: string;
  currentWeekStart: string;
  shouldCarry: boolean;
}

export function taskCarryoverContext(
  timeZone: string,
  requestedWeekStart: string,
  now = new Date(),
): TaskCarryoverContext {
  const today = todayInTimeZone(timeZone, now);
  const weekStart = currentWeekStart(timeZone, now);
  return {
    today,
    currentWeekStart: weekStart,
    shouldCarry: requestedWeekStart === weekStart,
  };
}

export function carryoverLabel(item: PlanningItem): string | null {
  if (!item.carryoverCount) return null;
  if (item.originalPlanningDate) {
    const origin = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(parseDateOnly(item.originalPlanningDate));
    return `Carried from ${origin}`;
  }
  if (item.originalWeekStartDate) {
    const origin = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(parseDateOnly(item.originalWeekStartDate));
    return `Carried from week of ${origin}`;
  }
  return "Carried over";
}

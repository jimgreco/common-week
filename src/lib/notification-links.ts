import { isDateOnly, weekStartForDate } from "@/lib/date";

export type PlannerNotificationTarget =
  | { kind: "planning_item"; id: string; weekStart: string }
  | { kind: "calendar_reminder"; id: string; weekStart: string };

function resourceId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(value) ? value : null;
}

export function plannerNotificationDeepLink(target: PlannerNotificationTarget): string {
  const params = new URLSearchParams({ week: weekStartForDate(target.weekStart) });
  params.set(target.kind === "planning_item" ? "item" : "reminder", target.id);
  return `/planner?${params.toString()}`;
}

export function plannerNotificationTarget(
  params: Record<string, string | string[] | undefined>,
): PlannerNotificationTarget | null {
  const week = typeof params.week === "string" && isDateOnly(params.week)
    ? weekStartForDate(params.week)
    : null;
  if (!week) return null;
  const itemId = resourceId(params.item);
  if (itemId) return { kind: "planning_item", id: itemId, weekStart: week };
  const reminderId = resourceId(params.reminder);
  if (reminderId) return { kind: "calendar_reminder", id: reminderId, weekStart: week };
  return null;
}

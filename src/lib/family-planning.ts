import { z } from "zod";
import type { TaskRoutine } from "@/types/domain";

const DAY_MS = 86_400_000;
export function validFamilyDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function familyDateOffset(date: string, offset: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
}
export function familyWeekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return familyDateOffset(date, -((day + 6) % 7));
}
const date = z.string().refine(validFamilyDate, "Choose a valid date.");
export const familyWeekSchema = date.refine((value) => familyWeekStart(value) === value, "Week must begin Monday.");
const uuid = z.string().uuid();
export const routineSchema = z.object({
  id: uuid.optional(),
  text: z.string().trim().min(1).max(1000),
  childId: uuid.nullable().optional().transform((value) => value ?? null),
  frequency: z.enum(["daily", "weekly"]),
  interval: z.number().int().min(1).max(52),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).transform((values) => [...new Set(values)].sort()),
  startsOn: date,
  endsOn: date.nullable().optional().transform((value) => value ?? null),
  active: z.boolean(),
}).refine((value) => !value.endsOn || value.endsOn >= value.startsOn, "End date must follow the start date.");
const week = { weekStart: familyWeekSchema };
export const familyMutationSchema = z.discriminatedUnion("action", [
  z.object({ ...week, action: z.literal("saveAdultCalendars"), userId: uuid, calendarPreferenceIds: z.array(uuid).max(100).transform((ids) => [...new Set(ids)]) }),
  z.object({ ...week, action: z.literal("saveChild"), child: z.object({
    id: uuid.optional(), name: z.string().trim().min(1).max(80), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    calendarPreferenceIds: z.array(uuid).max(30).transform((ids) => [...new Set(ids)]),
  }) }),
  z.object({ ...week, action: z.literal("deleteChild"), id: uuid }),
  z.object({ ...week, action: z.literal("saveRoutine"), sourceItemId: uuid.optional(), routine: routineSchema }),
  z.object({ ...week, action: z.literal("deleteRoutine"), id: uuid }),
  z.object({ ...week, action: z.literal("saveTemplate"), name: z.string().trim().min(1).max(100), id: uuid.optional() }),
  z.object({ ...week, action: z.literal("deleteTemplate"), id: uuid }),
  z.object({ ...week, action: z.literal("applyTemplate"), id: uuid }),
  z.object({ ...week, action: z.literal("saveReview"), priorities: z.string().max(4000), meals: z.string().max(4000), logistics: z.string().max(4000), revision: z.number().int().nonnegative() }),
  z.object({ ...week, action: z.literal("markReviewed"), reviewed: z.boolean(), revision: z.number().int().nonnegative().optional() }),
  z.object({ ...week, action: z.literal("assignChild"), itemId: uuid, childId: uuid.nullable() }),
]);

export interface RoutineOccurrence { occurrenceDate: string; planningDate: string | null }
/** Expand only one Monday-based week: at most seven tasks, without local-time/DST arithmetic. */
export function routineOccurrencesForWeek(routine: TaskRoutine, weekStart: string): RoutineOccurrence[] {
  familyWeekSchema.parse(weekStart);
  if (!routine.active) return [];
  const daysSinceStart = (value: string) => Math.round((Date.parse(`${value}T00:00:00Z`) - Date.parse(`${routine.startsOn}T00:00:00Z`)) / DAY_MS);
  const weekDelta = Math.round((Date.parse(`${weekStart}T00:00:00Z`) - Date.parse(`${familyWeekStart(routine.startsOn)}T00:00:00Z`)) / (7 * DAY_MS));
  if (routine.frequency === "weekly" && (weekDelta < 0 || weekDelta % routine.interval !== 0)) return [];
  if (routine.frequency === "weekly" && routine.weekdays.length === 0) {
    if (familyDateOffset(weekStart, 6) < routine.startsOn || (routine.endsOn && weekStart > routine.endsOn)) return [];
    return [{ occurrenceDate: weekStart, planningDate: null }];
  }
  return Array.from({ length: 7 }, (_, index) => ({ date: familyDateOffset(weekStart, index), index }))
    .filter(({ date, index }) => date >= routine.startsOn && (!routine.endsOn || date <= routine.endsOn)
      && (routine.frequency === "daily" ? daysSinceStart(date) % routine.interval === 0 && (routine.weekdays.length === 0 || routine.weekdays.includes(index)) : routine.weekdays.includes(index)))
    .map(({ date }) => ({ occurrenceDate: date, planningDate: date }));
}

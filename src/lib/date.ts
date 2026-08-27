import { addDays, differenceInCalendarDays, format, getDay } from "date-fns";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value) && !Number.isNaN(parseDateOnly(value).getTime());
}

export function parseDateOnly(value: string): Date {
  if (!DATE_ONLY.test(value)) {
    throw new Error(`Invalid date-only value: ${value}`);
  }

  return new Date(`${value}T12:00:00.000Z`);
}

export function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDateDays(value: string, amount: number): string {
  return toDateOnly(addDays(parseDateOnly(value), amount));
}

export function weekStartForDate(value: string): string {
  const parsed = parseDateOnly(value);
  const day = getDay(parsed);
  const daysSinceMonday = (day + 6) % 7;
  return addDateDays(value, -daysSinceMonday);
}

export function weekDates(weekStart: string): string[] {
  const monday = weekStartForDate(weekStart);
  return Array.from({ length: 7 }, (_, index) => addDateDays(monday, index));
}

export function datesForLocationScope(
  startDate: string,
  scope: "day" | "through-sunday" | "week",
): string[] {
  const monday = weekStartForDate(startDate);
  const start = scope === "week" ? monday : startDate;
  const end = scope === "day" ? start : addDateDays(monday, 6);
  const dates: string[] = [];
  for (let date = start; date <= end; date = addDateDays(date, 1)) dates.push(date);
  return dates;
}

export function todayInTimeZone(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function currentWeekStart(timeZone = "America/New_York", now = new Date()): string {
  return weekStartForDate(todayInTimeZone(timeZone, now));
}

export function formatWeekRange(weekStart: string): string {
  const start = parseDateOnly(weekStart);
  const end = parseDateOnly(addDateDays(weekStart, 6));
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();

  if (sameMonth) {
    return `${format(start, "MMMM d")}–${format(end, sameYear ? "d" : "d, yyyy")}`;
  }

  return `${format(start, "MMM d")}–${format(end, sameYear ? "MMM d" : "MMM d, yyyy")}`;
}

export function formatDayName(value: string, width: "short" | "long" = "short"): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: width,
    timeZone: "UTC",
  }).format(parseDateOnly(value));
}

export function formatDayNumber(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    timeZone: "UTC",
  }).format(parseDateOnly(value));
}

export function formatMobileDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(parseDateOnly(value));
}

export function isToday(value: string, timeZone = "America/New_York"): boolean {
  return value === todayInTimeZone(timeZone);
}

export function weekOffset(from: string, to: string): number {
  return Math.round(differenceInCalendarDays(parseDateOnly(to), parseDateOnly(from)) / 7);
}

export function formatEventTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

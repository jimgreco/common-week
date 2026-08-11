import { addDateDays } from "@/lib/date";

export interface ForecastWindow {
  requestStart: string | null;
  requestEnd: string | null;
  unavailableDates: string[];
}

export function forecastWindow(
  startDate: string,
  endDate: string,
  today: string,
  horizonDays = 15,
): ForecastWindow {
  const horizon = addDateDays(today, horizonDays);
  const unavailableDates: string[] = [];
  for (let cursor = startDate; cursor <= endDate; cursor = addDateDays(cursor, 1)) {
    if (cursor < today || cursor > horizon) unavailableDates.push(cursor);
  }
  const requestStart = startDate < today ? today : startDate;
  const requestEnd = endDate > horizon ? horizon : endDate;
  return requestStart > requestEnd
    ? { requestStart: null, requestEnd: null, unavailableDates }
    : { requestStart, requestEnd, unavailableDates };
}

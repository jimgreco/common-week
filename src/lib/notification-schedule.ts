import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { addDateDays, formatDayName } from "@/lib/date";

export type ScheduledNotificationOccurrence = {
  kind: "morning_digest" | "sunday_planning";
  localDate: string;
  scheduledFor: Date;
};

const MAX_CATCH_UP_MILLISECONDS = 24 * 60 * 60_000;

export function scheduledNotificationOccurrences(input: {
  now: Date;
  since: Date;
  timeZone: string;
  morningDigestEnabled: boolean;
  morningDigestTime: string;
  sundayPlanningEnabled: boolean;
  sundayPlanningTime: string;
}): ScheduledNotificationOccurrence[] {
  const lowerBound = new Date(Math.max(
    input.since.getTime(),
    input.now.getTime() - MAX_CATCH_UP_MILLISECONDS,
  ));
  const firstDate = formatInTimeZone(lowerBound, input.timeZone, "yyyy-MM-dd");
  const lastDate = formatInTimeZone(input.now, input.timeZone, "yyyy-MM-dd");
  const occurrences: ScheduledNotificationOccurrence[] = [];

  for (let localDate = firstDate; localDate <= lastDate; localDate = addDateDays(localDate, 1)) {
    if (input.morningDigestEnabled) {
      addIfDue(occurrences, {
        kind: "morning_digest",
        localDate,
        localTime: input.morningDigestTime,
        timeZone: input.timeZone,
        lowerBound,
        now: input.now,
      });
    }
    if (input.sundayPlanningEnabled && formatDayName(localDate, "long") === "Sunday") {
      addIfDue(occurrences, {
        kind: "sunday_planning",
        localDate,
        localTime: input.sundayPlanningTime,
        timeZone: input.timeZone,
        lowerBound,
        now: input.now,
      });
    }
  }
  return occurrences.sort((left, right) => left.scheduledFor.getTime() - right.scheduledFor.getTime());
}

function addIfDue(
  occurrences: ScheduledNotificationOccurrence[],
  input: {
    kind: ScheduledNotificationOccurrence["kind"];
    localDate: string;
    localTime: string;
    timeZone: string;
    lowerBound: Date;
    now: Date;
  },
) {
  const scheduledFor = fromZonedTime(`${input.localDate}T${input.localTime.slice(0, 5)}:00`, input.timeZone);
  if (scheduledFor > input.lowerBound && scheduledFor <= input.now) {
    occurrences.push({ kind: input.kind, localDate: input.localDate, scheduledFor });
  }
}

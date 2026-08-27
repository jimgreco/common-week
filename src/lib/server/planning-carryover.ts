import "server-only";

import { query } from "@/lib/server/database";
import { taskCarryoverContext } from "@/lib/task-carryover";

export async function carryOverOpenTasks(input: {
  householdId: string;
  timeZone: string;
  requestedWeekStart: string;
  now?: Date;
}): Promise<number> {
  const now = input.now ?? new Date();
  const context = taskCarryoverContext(input.timeZone, input.requestedWeekStart, now);
  if (!context.shouldCarry) return 0;

  const result = await query<{ carried_count: number }>(
    `select carry_over_open_tasks(
       $1::uuid, $2::date, $3::date, $4::timestamptz
     ) as carried_count`,
    [input.householdId, context.today, context.currentWeekStart, now.toISOString()],
  );
  return Number(result.rows[0]?.carried_count ?? 0);
}

import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { query } from "@/lib/server/database";

// Read-only weekly summary for the weekly-review routine.
//
// The `data` payload must stay identical to weekly-review's
// src/sources/planner.js `collectPlanner` (same SQL, keys, ordering and
// limits), so these queries deliberately mirror it rather than reusing
// getPlannerData, which carries tasks over, materializes routines and calls
// Google. Everything here is a plain SELECT.

export type WeekBounds = { start: string; end: string };

type TaskRow = {
  id: string;
  text: string;
  is_completed: boolean;
  planning_date: string | null;
  week_start_date: string;
  deadline: string | null;
  carryover_count: number | null;
  is_backlog: boolean;
  responsible: string | null;
};

type NotesRow = {
  week_start_date: string;
  priorities: string;
  meals: string;
  logistics: string;
};

export type WeeklySummaryTask = {
  text: string;
  responsible: string | null;
  deadline: string | null;
  date: string | null;
  carryovers: number;
};

export type WeeklySummaryNotes = {
  priorities: string | null;
  meals: string | null;
  logistics: string | null;
} | null;

export type PlannerWeeklySummary =
  | { status: "no-account" }
  | {
      status: "ok";
      household: string;
      current: {
        taskCount: number;
        doneCount: number;
        openCount: number;
        done: WeeklySummaryTask[];
        stuck: WeeklySummaryTask[];
        notes: WeeklySummaryNotes;
      };
      nextWeek: { tasks: WeeklySummaryTask[]; notes: WeeklySummaryNotes };
      overdue: WeeklySummaryTask[];
    };

const TASK_COLUMNS = `
  p.id, p.text, p.is_completed, to_char(p.planning_date, 'YYYY-MM-DD') AS planning_date,
  to_char(p.week_start_date, 'YYYY-MM-DD') AS week_start_date,
  to_char(p.deadline, 'YYYY-MM-DD') AS deadline, p.carryover_count, p.is_backlog,
  COALESCE(ru.display_name, rc.name) AS responsible`;

const TASK_JOINS = `
  LEFT JOIN users ru ON ru.id = p.responsible_member_id
  LEFT JOIN child_profiles rc ON rc.id = p.responsible_member_id`;

const SHA256_HEX = /^[0-9a-f]{64}$/;

export type WeeklySummaryConfig = { tokenSha256: string; email: string };

/** Both variables must be present; otherwise the route does not exist. */
export function weeklySummaryConfig(env: NodeJS.ProcessEnv = process.env): WeeklySummaryConfig | null {
  const tokenSha256 = env.WEEKLY_SUMMARY_TOKEN_SHA256?.trim().toLowerCase() ?? "";
  const email = env.WEEKLY_SUMMARY_EMAIL?.trim() ?? "";
  if (!SHA256_HEX.test(tokenSha256) || !email) return null;
  return { tokenSha256, email };
}

/**
 * Constant-time check of an `Authorization: Bearer <token>` header against the
 * stored SHA-256. This is the only credential this route accepts; it never
 * consults user sessions, and session tokens are never accepted here.
 */
export function isWeeklySummaryAuthorized(authorization: string | null, tokenSha256: string): boolean {
  const match = authorization?.match(/^Bearer\s+(\S+)\s*$/i);
  if (!match) return false;
  const presented = createHash("sha256").update(match[1], "utf8").digest();
  const expected = Buffer.from(tokenSha256, "hex");
  return expected.length === presented.length && timingSafeEqual(presented, expected);
}

async function householdForEmail(email: string) {
  // users.email is citext, so this match is case-insensitive.
  const { rows } = await query<{ id: string; name: string; timezone: string }>(
  `SELECT h.id, h.name, h.timezone
     FROM users u
     JOIN household_members m ON m.user_id = u.id
     JOIN households h ON h.id = m.household_id
    WHERE u.email = $1`,
  [email],
);
return rows[0] ?? null;
}

export async function collectPlannerSummary(
email: string,
week: WeekBounds,
next: WeekBounds,
): Promise<PlannerWeeklySummary> {
const hh = await householdForEmail(email);
if (!hh) return { status: "no-account" };

  // Sequential, like collectPlanner: one pool connection at a time.
  const thisWeek = await query<TaskRow>(
    `SELECT ${TASK_COLUMNS} FROM planning_items p ${TASK_JOINS}
      WHERE p.household_id = $1 AND p.type = 'task' AND NOT p.is_backlog
        AND p.week_start_date = $2::date
      ORDER BY p.planning_date NULLS LAST, p.sort_order`,
    [hh.id, week.start],
  );
  const upcoming = await query<TaskRow>(
    `SELECT ${TASK_COLUMNS} FROM planning_items p ${TASK_JOINS}
      WHERE p.household_id = $1 AND p.type = 'task' AND NOT p.is_completed
        AND (p.week_start_date = $2::date OR p.deadline BETWEEN $2::date AND $3::date)
      ORDER BY p.deadline NULLS LAST, p.planning_date NULLS LAST, p.sort_order
      LIMIT 25`,
    [hh.id, next.start, next.end],
  );
  const overdue = await query<TaskRow>(
    `SELECT ${TASK_COLUMNS} FROM planning_items p ${TASK_JOINS}
      WHERE p.household_id = $1 AND p.type = 'task' AND NOT p.is_completed
        AND p.deadline < $2::date
      ORDER BY p.deadline LIMIT 10`,
    [hh.id, next.start],
  );
  const notes = await query<NotesRow>(
    `SELECT to_char(week_start_date, 'YYYY-MM-DD') AS week_start_date, priorities, meals, logistics
       FROM weekly_reviews WHERE household_id = $1 AND week_start_date IN ($2::date, $3::date)`,
    [hh.id, week.start, next.start],
  );

  const tasks = thisWeek.rows;
  const done = tasks.filter((task) => task.is_completed);
  const open = tasks.filter((task) => !task.is_completed);
  const brief = (task: TaskRow): WeeklySummaryTask => ({
    text: task.text,
    responsible: task.responsible ?? null,
    deadline: task.deadline,
    date: task.planning_date,
    carryovers: task.carryover_count ?? 0,
  });
  const notesFor = (start: string): WeeklySummaryNotes => {
    const row = notes.rows.find((candidate) => candidate.week_start_date === start);
    return row
      ? { priorities: row.priorities || null, meals: row.meals || null, logistics: row.logistics || null }
      : null;
  };

  return {
    status: "ok",
    household: hh.name,
    current: {
      taskCount: tasks.length,
      doneCount: done.length,
      openCount: open.length,
      done: done.map(brief).slice(0, 12),
      // Open tasks that have already been carried over at least twice.
      stuck: open.filter((task) => (task.carryover_count ?? 0) >= 2).map(brief).slice(0, 6),
      notes: notesFor(week.start),
    },
    nextWeek: {
      tasks: upcoming.rows.map(brief),
      notes: notesFor(next.start),
    },
    overdue: overdue.rows.map(brief),
  };
}

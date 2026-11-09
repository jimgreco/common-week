import type { NextRequest } from "next/server";
import { addDateDays, isDateOnly, weekStartForDate } from "@/lib/date";
import { isDemoMode } from "@/lib/env";
import {
  collectPlannerSummary,
  isWeeklySummaryAuthorized,
  weeklySummaryConfig,
} from "@/lib/server/weekly-summary";

export const runtime = "nodejs";

// Read-only summary for the weekly-review routine. See
// docs/DEPLOYMENT.md#weekly-summary-endpoint. Only the dedicated
// WEEKLY_SUMMARY_TOKEN_SHA256 bearer is accepted; user sessions (cookie or
// bearer) are never consulted, and every auth failure looks like a missing route.

const noStore = { "Cache-Control": "no-store" };

function notFound() {
  return Response.json({ error: "not found" }, { status: 404, headers: noStore });
}

export async function GET(request: NextRequest) {
  if (isDemoMode) return notFound();
  const config = weeklySummaryConfig();
  if (!config) return notFound();
  if (!isWeeklySummaryAuthorized(request.headers.get("authorization"), config.tokenSha256)) return notFound();

  const start = request.nextUrl.searchParams.get("week") ?? "";
  if (!isDateOnly(start) || weekStartForDate(start) !== start) {
    return Response.json({ error: "week must be a Monday (YYYY-MM-DD)" }, { status: 400, headers: noStore });
  }
  const week = { start, end: addDateDays(start, 6) };
  const nextStart = addDateDays(start, 7);
  const next = { start: nextStart, end: addDateDays(nextStart, 6) };

  try {
    const data = await collectPlannerSummary(config.email, week, next);
    return Response.json({
      version: 1,
      app: "planner",
      week,
      generatedAt: new Date().toISOString(),
      data,
    }, { headers: noStore });
  } catch {
    // database.query() already logs a sanitized failure; never echo SQL or stacks.
    return Response.json({ error: "internal" }, { status: 500, headers: noStore });
  }
}

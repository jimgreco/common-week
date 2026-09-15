import type { NextRequest } from "next/server";
import { isDateOnly, weekStartForDate } from "@/lib/date";
import { bearerTokenForAuthorization } from "@/lib/auth-token";
import { SESSION_COOKIE, sessionIdentityForToken } from "@/lib/server/session";
import { getPlannerData } from "@/lib/server/planner-data";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value
    ?? bearerTokenForAuthorization(request.headers.get("authorization"));
  const identity = await sessionIdentityForToken(token);
  if (!identity?.householdId) return Response.json({ ok: false, error: "Sign in to load your planner." }, { status: 401 });
  const source = request.nextUrl.searchParams.get("source");
  const week = request.nextUrl.searchParams.get("week");
  if ((source !== "calendar" && source !== "weather") || !week || !isDateOnly(week) || weekStartForDate(week) !== week) {
    return Response.json({ ok: false, error: "Choose a valid week and source." }, { status: 400 });
  }
  try {
    const data = await getPlannerData({ userId: identity.userId, householdId: identity.householdId }, week, { includeExternal: source });
    return Response.json({ ok: true, data: {
      days: data.days.map(({ date, events, location, weather, memberLocations }) => ({ date, events, location, weather, memberLocations })),
      calendarState: data.calendarState,
      weatherState: data.weatherState,
    } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false, error: `${source === "calendar" ? "Calendar" : "Weather"} could not be refreshed. Try again.` }, { status: 503 });
  }
}

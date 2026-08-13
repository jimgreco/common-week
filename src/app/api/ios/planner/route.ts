import type { NextRequest } from "next/server";
import { currentWeekStart, isDateOnly, weekStartForDate } from "@/lib/date";
import { requireIOSIdentity, unauthorizedResponse } from "@/lib/server/ios-api";
import { getPlannerData } from "@/lib/server/planner-data";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await requireIOSIdentity(request);
  if (!session) return unauthorizedResponse();
  if (!session.identity.householdId) {
    return Response.json({ ok: false, error: "Household setup is required." }, { status: 409 });
  }
  const requested = request.nextUrl.searchParams.get("week");
  const weekStart = requested && isDateOnly(requested)
    ? weekStartForDate(requested)
    : currentWeekStart();
  try {
    const data = await getPlannerData({
      userId: session.identity.userId,
      householdId: session.identity.householdId,
    }, weekStart, { includeExternal: true });
    return Response.json({ ok: true, data: { planner: data, user: session.identity } }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ ok: false, error: "Your shared week could not be loaded." }, { status: 500 });
  }
}

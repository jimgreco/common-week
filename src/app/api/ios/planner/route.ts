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
    }, weekStart, { includeExternal: request.nextUrl.searchParams.get("core") !== "1" });
    // Older installed clients require every hourly number. Omit incomplete hours
    // for them rather than inventing values or failing the entire planner decode.
    if (request.nextUrl.searchParams.get("nullable_weather") !== "1") {
      for (const day of data.days) {
        for (const weather of [day.weather, ...day.memberLocations.map((member) => member.weather)]) {
          if (weather) weather.hourly = weather.hourly.filter((hour) => [hour.temperatureF, hour.precipitationProbability, hour.precipitationAmount, hour.windSpeedMph, hour.conditionCode].every((value) => typeof value === "number" && Number.isFinite(value)));
        }
      }
    }
    // Keep an empty key for already-installed native clients that predate category removal.
    const planner = { ...data, categories: [] };
    return Response.json({ ok: true, data: { planner, user: session.identity } }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ ok: false, error: "Your shared week could not be loaded." }, { status: 500 });
  }
}

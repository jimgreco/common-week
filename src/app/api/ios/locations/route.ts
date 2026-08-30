import type { NextRequest } from "next/server";
import { z } from "zod";
import { searchLocationsAction, setDailyLocationAction, setGeocodedLocationAction } from "@/app/actions/planner";
import { actionResponse, requireIOSIdentity, unauthorizedResponse } from "@/lib/server/ios-api";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!(await requireIOSIdentity(request))) return unauthorizedResponse();
  return actionResponse(await searchLocationsAction(request.nextUrl.searchParams.get("q") ?? ""));
}

export async function PATCH(request: NextRequest) {
  if (!(await requireIOSIdentity(request))) return unauthorizedResponse();
  try {
    const body = await request.json();
    const savedLocation = z.object({
      startDate: z.string(),
      locationId: z.string().uuid(),
      memberIds: z.array(z.string().uuid()).min(1).optional(),
      scope: z.enum(["day", "through-sunday", "week"]),
    }).safeParse(body);
    if (savedLocation.success) {
      return actionResponse(await setDailyLocationAction(savedLocation.data));
    }

    const geocodedLocation = z.object({
      startDate: z.string(),
      memberIds: z.array(z.string().uuid()).min(1).optional(),
      scope: z.enum(["day", "through-sunday", "week"]),
      saveForReuse: z.boolean(),
      location: z.object({
        name: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        timezone: z.string(),
      }),
    }).parse(body);
    return actionResponse(await setGeocodedLocationAction(geocodedLocation));
  } catch {
    return actionResponse({ ok: false, error: "Choose a valid location and try again." });
  }
}

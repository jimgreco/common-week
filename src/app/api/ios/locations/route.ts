import type { NextRequest } from "next/server";
import { z } from "zod";
import { setDailyLocationAction } from "@/app/actions/planner";
import { actionResponse, requireIOSIdentity, unauthorizedResponse } from "@/lib/server/ios-api";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest) {
  if (!(await requireIOSIdentity(request))) return unauthorizedResponse();
  try {
    const input = z.object({
      startDate: z.string(),
      locationId: z.string().uuid(),
      scope: z.enum(["day", "through-sunday", "week"]),
    }).parse(await request.json());
    return actionResponse(await setDailyLocationAction(input));
  } catch {
    return actionResponse({ ok: false, error: "Choose a valid location and try again." });
  }
}

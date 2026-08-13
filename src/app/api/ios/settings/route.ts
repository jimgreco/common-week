import type { NextRequest } from "next/server";
import { z } from "zod";
import { inviteMemberAction, updateHouseholdAction } from "@/app/actions/settings";
import { actionResponse, requireIOSIdentity, unauthorizedResponse } from "@/lib/server/ios-api";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest) {
  if (!(await requireIOSIdentity(request))) return unauthorizedResponse();
  try {
    const body = z.record(z.string(), z.unknown()).parse(await request.json());
    if (body.action === "invite") {
      return actionResponse(await inviteMemberAction(z.string().email().parse(body.email)));
    }
    const input = z.object({
      name: z.string(),
      timezone: z.string(),
      temperatureUnit: z.enum(["fahrenheit", "celsius"]),
    }).parse(body);
    return actionResponse(await updateHouseholdAction(input));
  } catch {
    return actionResponse({ ok: false, error: "Check the settings and try again." });
  }
}

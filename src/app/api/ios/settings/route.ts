import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  inviteMemberAction,
  removeMemberAction,
  refreshGoogleCalendarsAction,
  transferOwnershipAction,
  updateCalendarPreferenceAction,
  updateHouseholdAction,
} from "@/app/actions/settings";
import { getCurrentUserCalendarPreferences } from "@/lib/server/calendar-data";
import { query } from "@/lib/server/database";
import { GOOGLE_CALENDAR_WRITE_SCOPE, hasGoogleScope } from "@/lib/server/google-oauth";
import { actionResponse, requireIOSIdentity, unauthorizedResponse } from "@/lib/server/ios-api";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await requireIOSIdentity(request);
  if (!session) return unauthorizedResponse();
  if (!session.identity.householdId) {
    return Response.json({ ok: false, error: "Household setup is required." }, { status: 409 });
  }
  const [calendars, connection] = await Promise.all([
    getCurrentUserCalendarPreferences(session.identity.userId),
    query<{ scope: string | null }>(
      "select scope from google_connections where user_id = $1",
      [session.identity.userId],
    ),
  ]);
  return Response.json({
    ok: true,
    data: {
      calendars,
      connected: Boolean(connection.rowCount),
      writeEnabled: hasGoogleScope(connection.rows[0]?.scope, GOOGLE_CALENDAR_WRITE_SCOPE),
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest) {
  if (!(await requireIOSIdentity(request))) return unauthorizedResponse();
  try {
    const body = z.record(z.string(), z.unknown()).parse(await request.json());
    if (body.action === "invite") {
      return actionResponse(await inviteMemberAction(z.string().email().parse(body.email)));
    }
    if (body.action === "removeMember") {
      return actionResponse(await removeMemberAction(z.string().uuid().parse(body.id)));
    }
    if (body.action === "transferOwnership") {
      return actionResponse(await transferOwnershipAction(z.string().uuid().parse(body.id)));
    }
    if (body.action === "refreshCalendars") {
      return actionResponse(await refreshGoogleCalendarsAction());
    }
    if (body.action === "updateCalendar") {
      const input = z.object({
        id: z.string().uuid(),
        visibility: z.enum(["hide", "private", "share"]),
        displayAlias: z.string().nullable(),
        displayAbbreviation: z.string().nullable(),
        sectionGroup: z.enum(["critical", "supplemental"]),
      }).parse(body);
      return actionResponse(await updateCalendarPreferenceAction(input));
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

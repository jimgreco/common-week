import type { NextRequest } from "next/server";
import { z } from "zod";
import { setCalendarReminderAction, updateNotificationPreferencesAction } from "@/app/actions/notifications";
import { requireIOSIdentity, unauthorizedResponse, actionResponse } from "@/lib/server/ios-api";
import { getNotificationPreferences } from "@/lib/server/notifications";
import { query } from "@/lib/server/database";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await requireIOSIdentity(request);
  if (!session) return unauthorizedResponse();
  return Response.json({ ok: true, data: await getNotificationPreferences(session.identity.userId) });
}

export async function PATCH(request: NextRequest) {
  if (!(await requireIOSIdentity(request))) return unauthorizedResponse();
  try {
    const body = z.record(z.string(), z.unknown()).parse(await request.json());
    if (body.action === "calendarReminder") {
      const result = await setCalendarReminderAction({
        calendarPreferenceId: z.string().uuid().parse(body.calendarPreferenceId),
        providerEventId: z.string().min(1).parse(body.providerEventId),
        remindAt: body.remindAt == null ? null : z.string().datetime().parse(body.remindAt),
      });
      return actionResponse(result.ok ? { ok: true, data: { reminder: result.data ?? null } } : result);
    }
    return actionResponse(await updateNotificationPreferencesAction({
      emailEnabled: z.boolean().parse(body.emailEnabled),
      pushEnabled: z.boolean().parse(body.pushEnabled),
      morningDigestEnabled: z.boolean().parse(body.morningDigestEnabled),
      morningDigestTime: z.string().parse(body.morningDigestTime),
      sundayPlanningEnabled: z.boolean().parse(body.sundayPlanningEnabled),
      sundayPlanningTime: z.string().parse(body.sundayPlanningTime),
      householdChangeAlerts: z.boolean().parse(body.householdChangeAlerts),
    }));
  } catch {
    return actionResponse({ ok: false, error: "Check the notification settings and try again." });
  }
}

export async function POST(request: NextRequest) {
  const session = await requireIOSIdentity(request);
  if (!session) return unauthorizedResponse();
  try {
    const body = z.object({
      deviceToken: z.string().regex(/^[0-9A-Fa-f]{64,}$/),
      environment: z.enum(["sandbox", "production"]),
    }).parse(await request.json());
    await query(
      `insert into push_devices (user_id, device_token, environment)
       values ($1, lower($2), $3)
       on conflict (device_token, environment) do update set user_id = excluded.user_id, updated_at = now()`,
      [session.identity.userId, body.deviceToken, body.environment],
    );
    return Response.json({ ok: true, data: {} });
  } catch {
    return Response.json({ ok: false, error: "This device could not be registered for notifications." }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await requireIOSIdentity(request);
  if (!session) return unauthorizedResponse();
  try {
    const body = z.object({ deviceToken: z.string() }).parse(await request.json());
    await query("delete from push_devices where user_id = $1 and device_token = lower($2)", [session.identity.userId, body.deviceToken]);
    return Response.json({ ok: true, data: {} });
  } catch {
    return Response.json({ ok: false, error: "Notification registration could not be removed." }, { status: 400 });
  }
}

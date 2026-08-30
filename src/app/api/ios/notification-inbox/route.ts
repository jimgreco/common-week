import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireIOSIdentity, unauthorizedResponse } from "@/lib/server/ios-api";
import { getNotificationInbox, markNotificationRead } from "@/lib/server/notifications";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await requireIOSIdentity(request);
  if (!session) return unauthorizedResponse();
  return Response.json({ ok: true, data: await getNotificationInbox(session.identity.userId) });
}

export async function PATCH(request: NextRequest) {
  const session = await requireIOSIdentity(request);
  if (!session) return unauthorizedResponse();
  try {
    const body = z.object({ id: z.string().uuid().optional() }).parse(await request.json());
    await markNotificationRead(session.identity.userId, body.id);
    return Response.json({ ok: true, data: {} });
  } catch {
    return Response.json({ ok: false, error: "Notification history could not be updated." }, { status: 400 });
  }
}

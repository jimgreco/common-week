import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireIOSIdentity, unauthorizedResponse } from "@/lib/server/ios-api";
import { createNativeConnectionCode } from "@/lib/server/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await requireIOSIdentity(request);
  if (!session) return unauthorizedResponse();
  try {
    const { state, calendarWrite } = z.object({ state: z.string().min(20).max(128).regex(/^[A-Za-z0-9_-]+$/), calendarWrite: z.boolean().optional() }).parse(await request.json());
    const code = await createNativeConnectionCode(session.identity.userId, state);
    return Response.json({ ok: true, data: { path: `/auth/google?platform=ios&client_state=${encodeURIComponent(state)}&connect_token=${encodeURIComponent(code)}${calendarWrite ? "&calendar_write=1" : ""}` } }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ ok: false, error: "Google Calendar connection could not be started." }, { status: 400 }); }
}

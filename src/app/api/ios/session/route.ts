import type { NextRequest } from "next/server";
import { requireIOSIdentity, unauthorizedResponse } from "@/lib/server/ios-api";
import { deleteSessionForToken } from "@/lib/server/session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await requireIOSIdentity(request);
  if (!session) return unauthorizedResponse();
  return Response.json({ ok: true, data: session.identity }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: NextRequest) {
  const session = await requireIOSIdentity(request);
  if (!session) return unauthorizedResponse();
  await deleteSessionForToken(session.token);
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

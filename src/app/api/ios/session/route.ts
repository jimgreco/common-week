import type { NextRequest } from "next/server";
import { requireIOSIdentity, unauthorizedResponse } from "@/lib/server/ios-api";
import { deleteSessionForToken } from "@/lib/server/session";
import { permanentlyDeleteUser } from "@/lib/server/account-deletion";

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

export async function POST(request: NextRequest) {
  const session = await requireIOSIdentity(request);
  if (!session) return unauthorizedResponse();
  const body = await request.json().catch(() => ({})) as { action?: string; confirmation?: string };
  if (body.action !== "delete-account" || body.confirmation !== "DELETE") {
    return Response.json({ ok: false, error: "Type DELETE to confirm." }, { status: 400 });
  }
  try {
    await permanentlyDeleteUser(session.identity.userId);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Your account could not be deleted." }, { status: 400 });
  }
}

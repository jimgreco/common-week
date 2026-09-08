import type { NextRequest } from "next/server";
import { saveEventMembersAction } from "@/app/actions/household-assignments";
import { actionResponse, requireIOSIdentity, unauthorizedResponse } from "@/lib/server/ios-api";
export async function PUT(request: NextRequest) {
  if (!(await requireIOSIdentity(request))) return unauthorizedResponse();
  try { return actionResponse(await saveEventMembersAction(await request.json())); }
  catch { return actionResponse({ ok: false, error: "Check the household assignments and try again." }); }
}

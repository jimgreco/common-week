import type { NextRequest } from "next/server";
import { searchPlannerAction } from "@/app/actions/planner";
import { actionResponse, requireIOSIdentity, unauthorizedResponse } from "@/lib/server/ios-api";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!(await requireIOSIdentity(request))) return unauthorizedResponse();
  return actionResponse(await searchPlannerAction(request.nextUrl.searchParams.get("q") ?? ""));
}

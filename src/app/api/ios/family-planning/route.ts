import type { NextRequest } from "next/server";
import { loadFamilyPlanningAction, mutateFamilyPlanningAction } from "@/app/actions/family-planning";
import { familyMutationSchema } from "@/lib/family-planning";
import { actionResponse, requireIOSIdentity, unauthorizedResponse } from "@/lib/server/ios-api";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  if (!(await requireIOSIdentity(request))) return unauthorizedResponse();
  return actionResponse(await loadFamilyPlanningAction(request.nextUrl.searchParams.get("week") ?? ""));
}
export async function POST(request: NextRequest) {
  if (!(await requireIOSIdentity(request))) return unauthorizedResponse();
  try {
    return actionResponse(await mutateFamilyPlanningAction(familyMutationSchema.parse(await request.json())));
  } catch {
    return actionResponse({ ok: false, error: "Check the family planning details and try again." });
  }
}

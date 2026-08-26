import type { NextRequest } from "next/server";
import { z } from "zod";
import { createCalendarEventAction, deleteCalendarEventAction, respondToCalendarEventAction, updateCalendarEventAction } from "@/app/actions/calendar";
import { hideCalendarEventAction } from "@/app/actions/planner";
import { actionResponse, requireIOSIdentity, unauthorizedResponse } from "@/lib/server/ios-api";
import type { CalendarEventDraft } from "@/types/domain";

export const runtime = "nodejs";

async function bodyForRequest(request: NextRequest) {
  return z.record(z.string(), z.unknown()).parse(await request.json());
}

export async function POST(request: NextRequest) {
  if (!(await requireIOSIdentity(request))) return unauthorizedResponse();
  const body = await bodyForRequest(request);
  return actionResponse(await createCalendarEventAction(body as unknown as CalendarEventDraft));
}

export async function PATCH(request: NextRequest) {
  if (!(await requireIOSIdentity(request))) return unauthorizedResponse();
  const body = await bodyForRequest(request);
  if (body.action === "hide") {
    return actionResponse(await hideCalendarEventAction(body as unknown as Parameters<typeof hideCalendarEventAction>[0]));
  }
  if (body.action === "respond") {
    return actionResponse(await respondToCalendarEventAction(body as unknown as Parameters<typeof respondToCalendarEventAction>[0]));
  }
  return actionResponse(await updateCalendarEventAction(body as unknown as CalendarEventDraft));
}

export async function DELETE(request: NextRequest) {
  if (!(await requireIOSIdentity(request))) return unauthorizedResponse();
  const body = await bodyForRequest(request);
  return actionResponse(await deleteCalendarEventAction(body as unknown as Parameters<typeof deleteCalendarEventAction>[0]));
}

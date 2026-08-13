import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  createPlanningItemAction,
  deletePlanningItemAction,
  togglePlanningItemAction,
  updatePlanningItemAction,
} from "@/app/actions/planner";
import { actionResponse, requireIOSIdentity, unauthorizedResponse } from "@/lib/server/ios-api";

export const runtime = "nodejs";

const itemSchema = z.object({
  id: z.string().uuid().optional(),
  text: z.string().trim().min(1).max(1000),
  type: z.enum(["note", "task"]),
  planningDate: z.string().nullable(),
  weekStartDate: z.string(),
});

async function isAuthorized(request: NextRequest) {
  return Boolean(await requireIOSIdentity(request));
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorizedResponse();
  try {
    const input = itemSchema.omit({ id: true }).parse(await request.json());
    return actionResponse(await createPlanningItemAction(input));
  } catch {
    return actionResponse({ ok: false, error: "Check the planning item and try again." });
  }
}

export async function PATCH(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorizedResponse();
  try {
    const body = await request.json();
    if (body.action === "toggle") {
      const input = z.object({ id: z.string().uuid(), completed: z.boolean() }).parse(body);
      return actionResponse(await togglePlanningItemAction(input.id, input.completed));
    }
    const input = itemSchema.required({ id: true }).parse(body);
    return actionResponse(await updatePlanningItemAction(input));
  } catch {
    return actionResponse({ ok: false, error: "Check the planning item and try again." });
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorizedResponse();
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(await request.json());
    return actionResponse(await deletePlanningItemAction(id));
  } catch {
    return actionResponse({ ok: false, error: "That item could not be deleted." });
  }
}

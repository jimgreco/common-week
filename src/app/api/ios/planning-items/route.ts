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
  // Swift omits nil Optional values when synthesizing Encodable. Weekly items
  // therefore have no planningDate key, which is equivalent to an explicit
  // JSON null and must be normalized before calling the shared action.
  planningDate: z.string().nullable().optional().transform((value) => value ?? null),
  weekStartDate: z.string(),
  remindAt: z.string().datetime().nullable().optional(),
});

async function isAuthorized(request: NextRequest) {
  return Boolean(await requireIOSIdentity(request));
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorizedResponse();
  try {
    const input = itemSchema.parse(await request.json());
    const result = await createPlanningItemAction(input);
    if (!result.ok) console.error("iOS createPlanningItemAction error:", result.error);
    return actionResponse(result);
  } catch (error) {
    console.error("iOS POST planning item error:", error);
    return actionResponse({ ok: false, error: "Check the planning item and try again." });
  }
}

export async function PATCH(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorizedResponse();
  try {
    const body = await request.json();
    if (body.action === "toggle") {
      const input = z.object({ id: z.string().uuid(), completed: z.boolean() }).parse(body);
      const result = await togglePlanningItemAction(input.id, input.completed);
      if (!result.ok) console.error("iOS togglePlanningItemAction error:", result.error);
      return actionResponse(result);
    }
    const input = itemSchema.required({ id: true }).parse(body);
    const result = await updatePlanningItemAction(input);
    if (!result.ok) console.error("iOS updatePlanningItemAction error:", result.error);
    return actionResponse(result);
  } catch (error) {
    console.error("iOS PATCH planning item error:", error);
    return actionResponse({ ok: false, error: "Check the planning item and try again." });
  }
}

export async function DELETE(request: NextRequest) {
  if (!(await isAuthorized(request))) return unauthorizedResponse();
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(await request.json());
    const result = await deletePlanningItemAction(id);
    if (!result.ok) console.error("iOS deletePlanningItemAction error:", result.error);
    return actionResponse(result);
  } catch (error) {
    console.error("iOS DELETE planning item error:", error);
    return actionResponse({ ok: false, error: "That item could not be deleted." });
  }
}

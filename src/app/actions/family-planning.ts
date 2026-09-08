"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireHouseholdContext } from "@/lib/server/auth";
import { getFamilyPlanningData, mutateFamilyPlanning } from "@/lib/server/family-planning";
import type { ActionResult, FamilyPlanningData, FamilyPlanningMutation } from "@/types/domain";

function failure(error: unknown): ActionResult<FamilyPlanningData> {
  return { ok: false, error: error instanceof z.ZodError ? "Check the family planning details and try again."
    : error instanceof Error ? error.message : "Family planning could not be saved." };
}
export async function loadFamilyPlanningAction(weekStart: string): Promise<ActionResult<FamilyPlanningData>> {
  try { return { ok: true, data: await getFamilyPlanningData(await requireHouseholdContext(), weekStart) }; }
  catch (error) { return failure(error); }
}
export async function mutateFamilyPlanningAction(input: FamilyPlanningMutation): Promise<ActionResult<FamilyPlanningData>> {
  try {
    const data = await mutateFamilyPlanning(await requireHouseholdContext(), input);
    revalidatePath("/planner");
    return { ok: true, data };
  } catch (error) { return failure(error); }
}

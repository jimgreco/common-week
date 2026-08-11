"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireHouseholdContext, requireUserContext } from "@/lib/server/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/types/domain";

function errorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export async function createHouseholdFromForm(formData: FormData) {
  const name = z.string().trim().min(1).max(80).parse(formData.get("name"));
  const timezone = z.string().refine(validTimeZone).parse(formData.get("timezone") || "America/New_York");
  await requireUserContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_household", {
    household_name: name,
    household_timezone: timezone,
  });
  if (error) redirect("/onboarding?error=household");
  redirect("/settings?welcome=1");
}

export async function updateHouseholdAction(input: {
  name: string;
  timezone: string;
  temperatureUnit: "fahrenheit" | "celsius";
}): Promise<ActionResult> {
  try {
    const parsed = z.object({
      name: z.string().trim().min(1).max(80),
      timezone: z.string().refine(validTimeZone, "Choose a valid timezone."),
      temperatureUnit: z.enum(["fahrenheit", "celsius"]),
    }).parse(input);
    const context = await requireHouseholdContext();
    const supabase = await createClient();
    const { error } = await supabase.from("households").update({
      name: parsed.name,
      timezone: parsed.timezone,
      temperature_unit: parsed.temperatureUnit,
    }).eq("id", context.householdId);
    if (error) throw new Error("Household preferences could not be saved.");
    revalidatePath("/settings");
    revalidatePath("/planner");
    return { ok: true };
  } catch (error) {
    return errorResult(error, "Household preferences could not be saved.");
  }
}

export async function inviteMemberAction(email: string): Promise<ActionResult> {
  try {
    const invitedEmail = z.string().trim().toLowerCase().email().max(320).parse(email);
    const context = await requireHouseholdContext();
    if (invitedEmail === context.email.toLowerCase()) throw new Error("You already belong to this household.");
    const supabase = await createClient();
    const { data: existingProfile } = await supabase.from("profiles").select("id").eq("email", invitedEmail).maybeSingle();
    if (existingProfile) {
      const { data: existingMember } = await supabase
        .from("household_members")
        .select("id")
        .eq("household_id", context.householdId)
        .eq("user_id", existingProfile.id)
        .maybeSingle();
      if (existingMember) throw new Error("That person already belongs to this household.");
    }
    await supabase
      .from("household_invitations")
      .delete()
      .eq("household_id", context.householdId)
      .eq("email", invitedEmail)
      .eq("status", "pending");
    const { error } = await supabase.from("household_invitations").insert({
      household_id: context.householdId,
      email: invitedEmail,
      invited_by: context.userId,
    });
    if (error) throw new Error("The invitation could not be created.");
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    return errorResult(error, "The invitation could not be created.");
  }
}

export async function addLocationAction(input: {
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const parsed = z.object({
      name: z.string().trim().min(1).max(120),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      timezone: z.string().refine(validTimeZone),
    }).parse(input);
    const context = await requireHouseholdContext();
    const supabase = await createClient();
    const { data, error } = await supabase.from("locations").insert({
      household_id: context.householdId,
      ...parsed,
      is_saved: true,
    }).select("id").single();
    if (error || !data) throw new Error("The location could not be added.");
    revalidatePath("/settings");
    revalidatePath("/planner");
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return { ...errorResult(error, "The location could not be added."), data: undefined };
  }
}

export async function setDefaultLocationAction(locationId: string): Promise<ActionResult> {
  try {
    const parsedId = z.string().uuid().parse(locationId);
    const context = await requireHouseholdContext();
    const supabase = await createClient();
    const { data: location } = await supabase
      .from("locations")
      .select("id")
      .eq("id", parsedId)
      .eq("household_id", context.householdId)
      .maybeSingle();
    if (!location) throw new Error("That location is not available.");
    const { error } = await supabase.from("households").update({ default_location_id: parsedId }).eq("id", context.householdId);
    if (error) throw new Error("The default location could not be changed.");
    revalidatePath("/settings");
    revalidatePath("/planner");
    return { ok: true };
  } catch (error) {
    return errorResult(error, "The default location could not be changed.");
  }
}

export async function removeLocationAction(locationId: string): Promise<ActionResult> {
  try {
    const parsedId = z.string().uuid().parse(locationId);
    await requireHouseholdContext();
    const supabase = await createClient();
    const { error } = await supabase.from("locations").delete().eq("id", parsedId);
    if (error) throw new Error("The location could not be removed.");
    revalidatePath("/settings");
    revalidatePath("/planner");
    return { ok: true };
  } catch (error) {
    return errorResult(error, "The location could not be removed.");
  }
}

export async function updateCalendarPreferenceAction(input: {
  id: string;
  isSelected: boolean;
  displayAlias: string | null;
}): Promise<ActionResult> {
  try {
    const parsed = z.object({
      id: z.string().uuid(),
      isSelected: z.boolean(),
      displayAlias: z.string().trim().min(1).max(40).nullable(),
    }).parse(input);
    const context = await requireHouseholdContext();
    const supabase = await createClient();
    const { error } = await supabase.from("calendar_preferences").update({
      is_selected: parsed.isSelected,
      display_alias: parsed.displayAlias,
    }).eq("id", parsed.id).eq("user_id", context.userId);
    if (error) throw new Error("Calendar preference could not be saved.");
    revalidatePath("/settings");
    revalidatePath("/planner");
    return { ok: true };
  } catch (error) {
    return errorResult(error, "Calendar preference could not be saved.");
  }
}

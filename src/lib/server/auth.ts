import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export interface UserContext {
  userId: string;
  email: string;
  displayName: string;
  householdId: string | null;
  role: "owner" | "member" | "viewer" | null;
}

export const getUserContext = cache(async (): Promise<UserContext | null> => {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return null;

  const [{ data: membership }, { data: profile }] = await Promise.all([
    supabase
      .from("household_members")
      .select("household_id, role")
      .eq("user_id", authData.user.id)
      .maybeSingle(),
    supabase.from("profiles").select("display_name, email").eq("id", authData.user.id).maybeSingle(),
  ]);

  return {
    userId: authData.user.id,
    email: profile?.email ?? authData.user.email ?? "",
    displayName:
      profile?.display_name ??
      authData.user.user_metadata.full_name ??
      authData.user.user_metadata.name ??
      authData.user.email?.split("@")[0] ??
      "Family member",
    householdId: membership?.household_id ?? null,
    role: membership?.role ?? null,
  };
});

export async function requireUserContext(): Promise<UserContext> {
  const context = await getUserContext();
  if (!context) throw new Error("Authentication required.");
  return context;
}

export async function requireHouseholdContext(): Promise<UserContext & { householdId: string }> {
  const context = await requireUserContext();
  if (!context.householdId) throw new Error("Household setup is required.");
  return { ...context, householdId: context.householdId };
}

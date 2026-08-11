import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { getDemoPlannerData } from "@/lib/demo-data";
import { isSupabaseConfigured } from "@/lib/env";
import { getUserContext } from "@/lib/server/auth";
import { getCurrentUserCalendarPreferences } from "@/lib/server/calendar-data";
import { createClient } from "@/lib/supabase/server";
import type { HouseholdLocation, HouseholdMember } from "@/types/domain";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (!isSupabaseConfigured) {
    const data = getDemoPlannerData();
    return <SettingsScaffold><SettingsPanel household={data.household} members={data.members} invitations={[]} locations={data.locations} calendars={[]} isDemo /></SettingsScaffold>;
  }

  const context = await getUserContext();
  if (!context) redirect("/");
  if (!context.householdId) redirect("/onboarding");
  const supabase = await createClient();
  const [householdResult, membersResult, locationsResult, invitationsResult, calendars] = await Promise.all([
    supabase.from("households").select("id, name, timezone, temperature_unit, default_location_id").eq("id", context.householdId).single(),
    supabase.from("household_members").select("id, user_id, role").eq("household_id", context.householdId),
    supabase.from("locations").select("id, name, latitude, longitude, timezone, is_saved").eq("household_id", context.householdId).order("name"),
    supabase.from("household_invitations").select("id, email, status, expires_at").eq("household_id", context.householdId).eq("status", "pending"),
    getCurrentUserCalendarPreferences(context.userId),
  ]);
  if (!householdResult.data) throw new Error("Settings could not be loaded.");
  const memberRows = membersResult.data ?? [];
  const { data: profiles } = await supabase.from("profiles").select("id, display_name, email").in("id", memberRows.map((row) => row.user_id));
  const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const members: HouseholdMember[] = memberRows.map((member) => ({ id: member.id, userId: member.user_id, displayName: profileMap.get(member.user_id)?.display_name ?? "Family member", email: profileMap.get(member.user_id)?.email ?? "", role: member.role }));
  const locations: HouseholdLocation[] = (locationsResult.data ?? []).map((location) => ({ id: location.id, name: location.name, latitude: location.latitude, longitude: location.longitude, timezone: location.timezone, isSaved: location.is_saved, isDefault: location.id === householdResult.data.default_location_id }));
  return <SettingsScaffold><SettingsPanel household={{ id: householdResult.data.id, name: householdResult.data.name, timezone: householdResult.data.timezone, temperatureUnit: householdResult.data.temperature_unit }} members={members} invitations={(invitationsResult.data ?? []).map((invite) => ({ id: invite.id, email: invite.email, status: invite.status, expiresAt: invite.expires_at }))} locations={locations} calendars={calendars} isDemo={false} /></SettingsScaffold>;
}

function SettingsScaffold({ children }: { children: React.ReactNode }) {
  return <main className="app-frame"><header className="app-topbar"><BrandMark compact /><Link className="topbar-link back-to-planner" href="/planner"><ArrowLeft size={15} />Back to planner</Link></header><section className="settings-shell"><header className="settings-title"><p className="eyebrow">Common Week</p><h1>Settings</h1></header>{children}</section></main>;
}

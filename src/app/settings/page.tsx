import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { getDemoPlannerData } from "@/lib/demo-data";
import { isDemoMode } from "@/lib/env";
import { getUserContext } from "@/lib/server/auth";
import { getCurrentUserCalendarPreferences } from "@/lib/server/calendar-data";
import { query } from "@/lib/server/database";
import type { HouseholdLocation, HouseholdMember } from "@/types/domain";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (isDemoMode) {
    const data = getDemoPlannerData();
    return <SettingsScaffold><SettingsPanel household={data.household} members={data.members} invitations={[]} locations={data.locations} calendars={[]} calendarConnected={false} isDemo /></SettingsScaffold>;
  }

  const context = await getUserContext();
  if (!context) redirect("/");
  if (!context.householdId) redirect("/onboarding");
  const [householdResult, membersResult, locationsResult, invitationsResult, calendars, connectionResult] = await Promise.all([
    query<{ id: string; name: string; timezone: string; temperature_unit: "fahrenheit" | "celsius"; default_location_id: string | null }>(
      "select id, name, timezone, temperature_unit, default_location_id from households where id = $1",
      [context.householdId],
    ),
    query<{ id: string; user_id: string; role: "owner" | "member" | "viewer"; display_name: string; email: string }>(
      `select hm.id, hm.user_id, hm.role, u.display_name, u.email::text
         from household_members hm join users u on u.id = hm.user_id
        where hm.household_id = $1 order by hm.created_at`,
      [context.householdId],
    ),
    query<{ id: string; name: string; latitude: number; longitude: number; timezone: string; is_saved: boolean }>(
      "select id, name, latitude, longitude, timezone, is_saved from locations where household_id = $1 order by name",
      [context.householdId],
    ),
    query<{ id: string; email: string; status: string; expires_at: Date }>(
      "select id, email::text, status, expires_at from household_invitations where household_id = $1 and status = 'pending' order by created_at",
      [context.householdId],
    ),
    getCurrentUserCalendarPreferences(context.userId),
    query("select 1 from google_connections where user_id = $1", [context.userId]),
  ]);
  const household = householdResult.rows[0];
  if (!household) throw new Error("Settings could not be loaded.");
  const members: HouseholdMember[] = membersResult.rows.map((member) => ({ id: member.id, userId: member.user_id, displayName: member.display_name, email: member.email, role: member.role }));
  const locations: HouseholdLocation[] = locationsResult.rows.map((location) => ({ id: location.id, name: location.name, latitude: Number(location.latitude), longitude: Number(location.longitude), timezone: location.timezone, isSaved: location.is_saved, isDefault: location.id === household.default_location_id }));
  return <SettingsScaffold><SettingsPanel household={{ id: household.id, name: household.name, timezone: household.timezone, temperatureUnit: household.temperature_unit }} members={members} invitations={invitationsResult.rows.map((invite) => ({ id: invite.id, email: invite.email, status: invite.status, expiresAt: invite.expires_at.toISOString() }))} locations={locations} calendars={calendars} calendarConnected={Boolean(connectionResult.rowCount)} isDemo={false} /></SettingsScaffold>;
}

function SettingsScaffold({ children }: { children: React.ReactNode }) {
  return <main className="app-frame"><header className="app-topbar"><BrandMark compact /><Link className="topbar-link back-to-planner" href="/planner"><ArrowLeft size={15} />Back to planner</Link></header><section className="settings-shell"><header className="settings-title"><p className="eyebrow">Common Week</p><h1>Settings</h1></header>{children}</section></main>;
}

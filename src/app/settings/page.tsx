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
import { GOOGLE_CALENDAR_WRITE_SCOPE, hasGoogleScope } from "@/lib/server/google-oauth";
import type { HiddenCalendarEvent, HouseholdLocation, HouseholdMember } from "@/types/domain";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (isDemoMode) {
    const data = getDemoPlannerData();
    const demoCalendars = Array.from(new Map(data.days.flatMap((day) => day.events).map((event) => [event.calendarId, event])).values()).map((event, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      userId: "demo-jim",
      googleCalendarId: event.calendarId,
      calendarName: event.calendarName,
      displayAlias: null,
      displayAbbreviation: null,
      color: event.calendarColor,
      isSelected: true,
      isPrimary: index === 0,
      sectionGroup: event.sectionGroup,
      accessRole: "owner" as const,
    }));
    return <SettingsScaffold><SettingsPanel household={data.household} members={data.members} invitations={[]} locations={data.locations} calendars={demoCalendars} calendarConnected={false} calendarWriteEnabled isDemo /></SettingsScaffold>;
  }

  const context = await getUserContext();
  if (!context) redirect("/");
  if (!context.householdId) redirect("/onboarding");
  const [householdResult, membersResult, locationsResult, invitationsResult, calendars, connectionResult, hiddenEventsResult] = await Promise.all([
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
    query<{ scope: string | null }>("select scope from google_connections where user_id = $1", [context.userId]),
    query<{ id: string; event_id: string; title: string; calendar_name: string; event_start: string; hidden_at: Date }>(
      `select id, event_id, title, calendar_name, event_start, hidden_at
         from hidden_calendar_events
        where household_id = $1
        order by hidden_at desc
        limit 100`,
      [context.householdId],
    ),
  ]);
  const household = householdResult.rows[0];
  if (!household) throw new Error("Settings could not be loaded.");
  const members: HouseholdMember[] = membersResult.rows.map((member) => ({ id: member.id, userId: member.user_id, displayName: member.display_name, email: member.email, role: member.role }));
  const locations: HouseholdLocation[] = locationsResult.rows.map((location) => ({ id: location.id, name: location.name, latitude: Number(location.latitude), longitude: Number(location.longitude), timezone: location.timezone, isSaved: location.is_saved, isDefault: location.id === household.default_location_id }));
  const hiddenEvents: HiddenCalendarEvent[] = hiddenEventsResult.rows.map((event) => ({ id: event.id, eventId: event.event_id, title: event.title, calendarName: event.calendar_name, eventStart: event.event_start, hiddenAt: event.hidden_at.toISOString() }));
  return <SettingsScaffold><SettingsPanel household={{ id: household.id, name: household.name, timezone: household.timezone, temperatureUnit: household.temperature_unit }} members={members} invitations={invitationsResult.rows.map((invite) => ({ id: invite.id, email: invite.email, status: invite.status, expiresAt: invite.expires_at.toISOString() }))} locations={locations} calendars={calendars} hiddenEvents={hiddenEvents} calendarConnected={Boolean(connectionResult.rowCount)} calendarWriteEnabled={hasGoogleScope(connectionResult.rows[0]?.scope, GOOGLE_CALENDAR_WRITE_SCOPE)} isDemo={false} /></SettingsScaffold>;
}

function SettingsScaffold({ children }: { children: React.ReactNode }) {
  return <main className="app-frame"><header className="app-topbar"><BrandMark compact /><Link className="topbar-link back-to-planner" href="/planner"><ArrowLeft size={15} />Back to planner</Link></header><section className="settings-shell"><header className="settings-title"><p className="eyebrow">Week of Us</p><h1>Settings</h1></header>{children}</section></main>;
}

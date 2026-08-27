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
import { getNotificationPreferences } from "@/lib/server/notifications";
import { query } from "@/lib/server/database";
import { GOOGLE_CALENDAR_WRITE_SCOPE, hasGoogleScope } from "@/lib/server/google-oauth";
import type { HiddenCalendarEvent, HouseholdLocation, HouseholdMember, NotificationPreferences } from "@/types/domain";
import { ThemeProvider, useTheme } from "@/components/theme-provider";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

function SettingsPageContent() {
  const { theme, toggleTheme } = useTheme();
  return <SettingsPageInternal theme={theme} toggleTheme={toggleTheme} />;
}

async function SettingsPageInternal({ theme, toggleTheme }: { theme: string; toggleTheme: () => void }) {
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
      visibility: "share" as const,
      isPrimary: index === 0,
      sectionGroup: event.sectionGroup,
      accessRole: "owner" as const,
    }));
    const demoNotifications: NotificationPreferences = { emailEnabled: true, pushEnabled: true, morningDigestEnabled: false, morningDigestTime: "07:00", sundayPlanningEnabled: false, sundayPlanningTime: "18:00", householdChangeAlerts: false };
    return <SettingsScaffold><SettingsPanel theme={theme} toggleTheme={toggleTheme} household={data.household} members={data.members} invitations={[]} locations={data.locations} calendars={demoCalendars} notificationPreferences={demoNotifications} calendarConnected={false} calendarWriteEnabled currentUserId="demo-jim" isDemo /></SettingsScaffold>;
  }

  const context = await getUserContext();
  if (!context) redirect("/");
  if (!context.householdId) redirect("/onboarding");
  const [householdResult, membersResult, locationsResult, invitationsResult, calendars, connectionResult, hiddenEventsResult, notificationPreferences] = await Promise.all([
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
      "select id, name, latitude, longitude, timezone, is_saved from locations where household_id = $1 and is_saved = true order by name",
      [context.householdId],
    ),
    query<{ id: string; email: string; status: string; expires_at: Date; sent_at: Date | null; delivery_error: string | null }>(
      "select id, email::text, status, expires_at, sent_at, delivery_error from household_invitations where household_id = $1 and status = 'pending' order by created_at",
      [context.householdId],
    ),
    getCurrentUserCalendarPreferences(context.userId),
    query<{ scope: string | null }>("select scope from google_connections where user_id = $1", [context.userId]),
    query<{ id: string; event_id: string; title: string; calendar_name: string; event_start: string; hidden_at: Date }>(
      `select hce.id, hce.event_id, hce.title, hce.calendar_name, hce.event_start, hce.hidden_at
          from hidden_calendar_events hce
         where hce.household_id = $1
           and exists (
             select 1
               from calendar_preferences cp
              where cp.household_id = hce.household_id
                and (
                  cp.visibility = 'share'
                  or (cp.visibility = 'private' and cp.user_id = $2)
                )
                and left(hce.event_id, char_length(cp.google_calendar_id) + 1) = cp.google_calendar_id || ':'
           )
         order by hidden_at desc
         limit 100`,
      [context.householdId, context.userId],
    ),
    getNotificationPreferences(context.userId),
  ]);
  const household = householdResult.rows[0];
  if (!household) throw new Error("Settings could not be loaded.");
  const members: HouseholdMember[] = membersResult.rows.map((member) => ({ id: member.id, userId: member.user_id, displayName: member.display_name, email: member.email, role: member.role }));
  const locations: HouseholdLocation[] = locationsResult.rows.map((location) => ({ id: location.id, name: location.name, latitude: Number(location.latitude), longitude: Number(location.longitude), timezone: location.timezone, isSaved: location.is_saved, isDefault: location.id === household.default_location_id }));
  const hiddenEvents: HiddenCalendarEvent[] = hiddenEventsResult.rows.map((event) => ({ id: event.id, eventId: event.event_id, title: event.title, calendarName: event.calendar_name, eventStart: event.event_start, hiddenAt: event.hidden_at.toISOString() }));
  return <SettingsScaffold><SettingsPanel theme={theme} toggleTheme={toggleTheme} household={{ id: household.id, name: household.name, timezone: household.timezone, temperatureUnit: household.temperature_unit }} members={members} invitations={invitationsResult.rows.map((invite) => ({ id: invite.id, email: invite.email, status: invite.status, expiresAt: invite.expires_at.toISOString(), sentAt: invite.sent_at?.toISOString() ?? null, deliveryError: invite.delivery_error }))} locations={locations} calendars={calendars} hiddenEvents={hiddenEvents} notificationPreferences={notificationPreferences} calendarConnected={Boolean(connectionResult.rowCount)} calendarWriteEnabled={hasGoogleScope(connectionResult.rows[0]?.scope, GOOGLE_CALENDAR_WRITE_SCOPE)} currentUserId={context.userId} isDemo={false} /></SettingsScaffold>;
}

function SettingsScaffold({ children }: { children: React.ReactNode }) {
  return <main className="app-frame"><header className="app-topbar"><BrandMark compact /><Link className="topbar-link back-to-planner" href="/planner"><ArrowLeft size={15} />Back to planner</Link></header><section className="settings-shell"><header className="settings-title"><p className="eyebrow">Week of Us</p><h1>Settings</h1></header>{children}</section></main>;
}

export default function SettingsPage() {
  return (
    <ThemeProvider>
      <SettingsPageContent />
    </ThemeProvider>
  );
}

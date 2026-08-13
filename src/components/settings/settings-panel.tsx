"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, Check, LoaderCircle, LockKeyhole, MapPin, Plus, RefreshCw, Search, Trash2, UserPlus } from "lucide-react";
import {
  addLocationAction,
  inviteMemberAction,
  refreshGoogleCalendarsAction,
  removeLocationAction,
  restoreCalendarEventAction,
  setDefaultLocationAction,
  updateCalendarPreferenceAction,
  updateHouseholdAction,
} from "@/app/actions/settings";
import { signInWithGoogle } from "@/app/actions/auth";
import { searchLocationsAction } from "@/app/actions/planner";
import { calendarAbbreviation, normalizeCalendarAbbreviation } from "@/lib/calendar-utils";
import { formatMobileDate } from "@/lib/date";
import type { CalendarPreference, GeocodingResult, HiddenCalendarEvent, HouseholdLocation, HouseholdMember, HouseholdSummary } from "@/types/domain";

interface Invitation { id: string; email: string; status: string; expiresAt: string; }

export function SettingsPanel({
  household,
  members,
  invitations,
  locations: initialLocations,
  calendars: initialCalendars,
  hiddenEvents: initialHiddenEvents = [],
  calendarConnected: initialCalendarConnected,
  calendarWriteEnabled,
  isDemo,
}: {
  household: HouseholdSummary;
  members: HouseholdMember[];
  invitations: Invitation[];
  locations: HouseholdLocation[];
  calendars: CalendarPreference[];
  hiddenEvents?: HiddenCalendarEvent[];
  calendarConnected: boolean;
  calendarWriteEnabled: boolean;
  isDemo: boolean;
}) {
  const [locations, setLocations] = useState(initialLocations);
  const [calendars, setCalendars] = useState(initialCalendars);
  const [hiddenEvents, setHiddenEvents] = useState(initialHiddenEvents);
  const [calendarConnected, setCalendarConnected] = useState(initialCalendarConnected);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [locationQuery, setLocationQuery] = useState("");
  const [locationResults, setLocationResults] = useState<GeocodingResult[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const attemptedCalendarRefresh = useRef(false);

  const showMessage = useCallback((value: string) => { setMessage(value); window.setTimeout(() => setMessage(null), 4000); }, []);
  const refreshCalendars = useCallback(() => {
    if (isDemo) return;
    startTransition(async () => {
      const result = await refreshGoogleCalendarsAction();
      if (result.data) {
        setCalendars(result.data.calendars);
        setCalendarConnected(result.data.connected);
      }
      setCalendarError(result.ok ? null : result.error ?? "Google calendars could not be refreshed.");
      if (result.ok) showMessage("Google calendars refreshed");
    });
  }, [isDemo, showMessage]);

  useEffect(() => {
    if (isDemo || !calendarConnected || calendars.length || attemptedCalendarRefresh.current) return;
    attemptedCalendarRefresh.current = true;
    refreshCalendars();
  }, [calendarConnected, calendars.length, isDemo, refreshCalendars]);

  return (
    <div className="settings-layout">
      {message && <div className="settings-toast" role="status"><Check size={14} />{message}</div>}
      <aside className="settings-index" aria-label="Settings sections">
        <a href="#household">Household</a><a href="#calendars">Calendars</a><a href="#locations">Locations</a><a href="#preferences">Preferences</a>
      </aside>
      <div className="settings-sections">
        <section className="settings-section" id="household">
          <header><p className="eyebrow">Household</p><h2>The people sharing this week</h2></header>
          <form className="settings-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); if (isDemo) { showMessage("Demo household updated for this visit"); return; } startTransition(async () => { const result = await updateHouseholdAction({ name: String(form.get("name")), timezone: household.timezone, temperatureUnit: household.temperatureUnit }); showMessage(result.ok ? "Household name saved" : result.error ?? "Save failed"); }); }}>
            <label>Household name<input name="name" defaultValue={household.name} maxLength={80} /></label><button className="button button-secondary" disabled={pending}>Save</button>
          </form>
          <div className="member-list">{members.map((member) => <div className="member-row" key={member.id}><span className="member-avatar">{member.displayName.slice(0, 1)}</span><div><strong>{member.displayName}</strong><small>{member.email}</small></div><span>{member.role}</span></div>)}</div>
          <form className="invite-form" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const email = String(new FormData(form).get("email")); if (isDemo) { showMessage(`Demo invitation created for ${email}`); form.reset(); return; } startTransition(async () => { const result = await inviteMemberAction(email); showMessage(result.ok ? "Invitation created. They’ll join when they sign in with this address." : result.error ?? "Invite failed"); if (result.ok) form.reset(); }); }}>
            <UserPlus size={16} /><input name="email" type="email" placeholder="partner@example.com" aria-label="Partner email" required /><button className="button button-primary" disabled={pending}>Invite member</button>
          </form>
          {invitations.length > 0 && <div className="pending-invitations"><h3>Pending invitations</h3>{invitations.map((invite) => <div key={invite.id}><span>{invite.email}</span><small>{invite.status}</small></div>)}</div>}
          <p className="settings-help">The invited person signs in independently with Google. If the email matches, they join this household automatically; credentials are never shared.</p>
        </section>

        <section className="settings-section" id="calendars">
          <header><p className="eyebrow">Calendars</p><h2>Choose calendars to share</h2><p>Only calendars you select here appear in the shared workspace. Calendars left private—including their names and events—are not shown to other household members.</p></header>
          <div className="calendar-privacy-note"><LockKeyhole size={17} /><div><strong>Private by default</strong><p>New Google calendars stay off until you explicitly share them. You can make a shared calendar private again at any time.</p></div></div>
          {!isDemo && calendarConnected && (
            <div className={`calendar-editing-access ${calendarWriteEnabled ? "is-enabled" : ""}`}>
              <div><strong>{calendarWriteEnabled ? "Single-event editing enabled" : "Calendar editing is off"}</strong><p>{calendarWriteEnabled ? "You can create, edit, and delete single events on calendars where Google gives you write access." : "Enable this separately to keep the default Google connection read-only."}</p></div>
              {!calendarWriteEnabled && <a className="button button-secondary" href="/auth/google?calendar_write=1">Enable calendar editing</a>}
            </div>
          )}
          {calendarError && <div className="calendar-provider-error" role="status"><AlertTriangle size={15} /><span>{calendarError}</span></div>}
          {calendars.length ? <div className="calendar-settings-list">{calendars.map((calendar) => {
            const defaultAbbreviation = calendarAbbreviation(calendar.displayAlias ?? calendar.calendarName);
            return (
              <div className={`calendar-setting ${calendar.isSelected ? "is-shared" : "is-private"}`} key={calendar.id}>
                <button className={`toggle ${calendar.isSelected ? "is-on" : ""}`} type="button" role="switch" aria-checked={calendar.isSelected} aria-label={`Share ${calendar.calendarName} with workspace`} disabled={pending} onClick={() => { const isSelected = !calendar.isSelected; const next = calendars.map((candidate) => candidate.id === calendar.id ? { ...candidate, isSelected } : candidate); setCalendars(next); if (!isDemo) startTransition(async () => { const result = await updateCalendarPreferenceAction({ id: calendar.id, isSelected, displayAlias: calendar.displayAlias, displayAbbreviation: calendar.displayAbbreviation, sectionGroup: calendar.sectionGroup }); if (!result.ok) { setCalendars(calendars); showMessage(result.error ?? "Calendar sharing choice could not be saved"); } else showMessage(isSelected ? "Calendar shared with workspace" : "Calendar is private"); }); }}><i /></button>
                <span className="calendar-badge-preview" style={{ background: calendar.color }}>{calendar.displayAbbreviation ?? defaultAbbreviation}</span>
                <div className="calendar-setting-identity"><strong>{calendar.calendarName}</strong><small className={`calendar-sharing-status ${calendar.isSelected ? "is-shared" : "is-private"}`}>{calendar.isSelected ? "Shared with workspace" : "Private"}{calendar.isPrimary ? " · Primary" : ""}</small></div>
                <input className="calendar-alias-input" value={calendar.displayAlias ?? ""} placeholder="Display alias" aria-label={`Alias for ${calendar.calendarName}`} onChange={(event) => setCalendars((current) => current.map((candidate) => candidate.id === calendar.id ? { ...candidate, displayAlias: event.target.value || null } : candidate))} onBlur={(event) => { if (!isDemo) startTransition(async () => { const result = await updateCalendarPreferenceAction({ id: calendar.id, isSelected: calendar.isSelected, displayAlias: event.target.value.trim() || null, displayAbbreviation: calendar.displayAbbreviation, sectionGroup: calendar.sectionGroup }); if (!result.ok) showMessage(result.error ?? "Calendar alias could not be saved"); }); }} />
                <input className="calendar-abbreviation-input" value={calendar.displayAbbreviation ?? ""} maxLength={2} placeholder={defaultAbbreviation} aria-label={`Badge abbreviation for ${calendar.calendarName}`} title="Two-character calendar badge" onChange={(event) => { const value = normalizeCalendarAbbreviation(event.target.value); setCalendars((current) => current.map((candidate) => candidate.id === calendar.id ? { ...candidate, displayAbbreviation: value || null } : candidate)); }} onBlur={(event) => { if (!isDemo) startTransition(async () => { const value = normalizeCalendarAbbreviation(event.target.value); const result = await updateCalendarPreferenceAction({ id: calendar.id, isSelected: calendar.isSelected, displayAlias: calendar.displayAlias, displayAbbreviation: value || null, sectionGroup: calendar.sectionGroup }); if (!result.ok) showMessage(result.error ?? "Calendar badge could not be saved"); }); }} />
                <select className="calendar-section-select" value={calendar.sectionGroup} aria-label={`Section group for ${calendar.calendarName}`} onChange={(event) => { const sectionGroup = event.target.value === "supplemental" ? "supplemental" : "critical"; setCalendars((current) => current.map((candidate) => candidate.id === calendar.id ? { ...candidate, sectionGroup } : candidate)); if (!isDemo) startTransition(async () => { const result = await updateCalendarPreferenceAction({ id: calendar.id, isSelected: calendar.isSelected, displayAlias: calendar.displayAlias, displayAbbreviation: calendar.displayAbbreviation, sectionGroup }); if (!result.ok) { setCalendars(calendars); showMessage(result.error ?? "Calendar section could not be saved"); } }); }}><option value="critical">Critical</option><option value="supplemental">Supplemental</option></select>
              </div>
            );
          })}</div> : <div className="empty-settings-state"><p>{calendarConnected ? "Google is connected, but calendars are not available yet." : "No Google Calendars are connected yet."}</p>{!isDemo && (calendarConnected ? <button className="button button-secondary" type="button" disabled={pending} onClick={refreshCalendars}><RefreshCw className={pending ? "spin" : ""} size={14} />Try Calendar again</button> : <form action={signInWithGoogle}><button className="button button-primary" type="submit">Connect Google Calendar</button></form>)} {isDemo && <span>Calendars appear here after Google setup.</span>}</div>}
          {calendars.length > 0 && !isDemo && <div className="calendar-refresh-row"><button className="text-button" type="button" disabled={pending} onClick={refreshCalendars}><RefreshCw className={pending ? "spin" : ""} size={13} />Refresh calendars</button></div>}
          {hiddenEvents.length > 0 && <div className="hidden-calendar-events"><h3>Hidden events</h3><p>These events are hidden from the shared planner only. Google Calendar is unchanged.</p>{hiddenEvents.map((event) => <div className="hidden-calendar-event" key={event.id}><div><strong>{event.title}</strong><small>{event.calendarName} · {formatMobileDate(event.eventStart.slice(0, 10))}</small></div><button className="text-button" type="button" disabled={pending} onClick={() => { if (isDemo) { setHiddenEvents((current) => current.filter((candidate) => candidate.id !== event.id)); return; } startTransition(async () => { const result = await restoreCalendarEventAction(event.id); if (result.ok) { setHiddenEvents((current) => current.filter((candidate) => candidate.id !== event.id)); showMessage("Event restored to the planner"); } else showMessage(result.error ?? "Event could not be restored"); }); }}>Restore</button></div>)}</div>}
        </section>

        <section className="settings-section" id="locations">
          <header><p className="eyebrow">Locations</p><h2>Your regular places</h2><p>The default fills unassigned days. Daily and multi-day overrides always win.</p></header>
          <div className="location-settings-list">{locations.map((location) => <div className="location-setting" key={location.id}><MapPin size={15} /><div><strong>{location.name}</strong><small>{location.timezone}</small></div>{location.isDefault ? <span className="default-pill">Default</span> : <button className="text-button" type="button" onClick={() => { if (isDemo) { setLocations((current) => current.map((candidate) => ({ ...candidate, isDefault: candidate.id === location.id }))); return; } startTransition(async () => { const result = await setDefaultLocationAction(location.id); if (result.ok) setLocations((current) => current.map((candidate) => ({ ...candidate, isDefault: candidate.id === location.id }))); }); }}>Make default</button>}<button className="icon-button danger" type="button" aria-label={`Remove ${location.name}`} onClick={() => { if (isDemo) { setLocations((current) => current.filter((candidate) => candidate.id !== location.id)); return; } startTransition(async () => { const result = await removeLocationAction(location.id); if (result.ok) setLocations((current) => current.filter((candidate) => candidate.id !== location.id)); else showMessage(result.error ?? "Remove failed"); }); }}><Trash2 size={14} /></button></div>)}</div>
          <div className="location-search-box">
            <label><Search size={15} /><input value={locationQuery} onChange={(event) => { const value = event.target.value; setLocationQuery(value); if (value.trim().length < 2) { setLocationResults([]); return; } if (isDemo) { setLocationResults([{ id: "demo-paris", name: "Paris", country: "France", latitude: 48.8566, longitude: 2.3522, timezone: "Europe/Paris" }]); return; } startTransition(async () => { const result = await searchLocationsAction(value); setLocationResults(result.data ?? []); }); }} placeholder="Search Paris, Palm Beach, Sag Harbor…" /></label>
            {pending && <LoaderCircle className="spin" size={15} />}
            {locationResults.length > 0 && <div className="location-search-results">{locationResults.map((result) => <button type="button" key={result.id} onClick={() => { const name = [result.name, result.admin1].filter(Boolean).join(", "); if (isDemo) { setLocations((current) => [...current, { id: result.id, name, latitude: result.latitude, longitude: result.longitude, timezone: result.timezone, isSaved: true }]); setLocationResults([]); setLocationQuery(""); return; } startTransition(async () => { const saved = await addLocationAction({ name, latitude: result.latitude, longitude: result.longitude, timezone: result.timezone }); if (saved.ok && saved.data) { setLocations((current) => [...current, { id: saved.data!.id, name, latitude: result.latitude, longitude: result.longitude, timezone: result.timezone, isSaved: true }]); setLocationResults([]); setLocationQuery(""); } else showMessage(saved.error ?? "Location could not be added"); }); }}><Plus size={14} /><span><strong>{result.name}</strong><small>{[result.admin1, result.country].filter(Boolean).join(", ")}</small></span></button>)}</div>}
          </div>
        </section>

        <section className="settings-section" id="preferences">
          <header><p className="eyebrow">Preferences</p><h2>How your week is shown</h2></header>
          <form className="preference-grid" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); if (isDemo) { showMessage("Demo preferences updated"); return; } startTransition(async () => { const result = await updateHouseholdAction({ name: household.name, timezone: String(form.get("timezone")), temperatureUnit: form.get("temperature") === "celsius" ? "celsius" : "fahrenheit" }); showMessage(result.ok ? "Preferences saved" : result.error ?? "Save failed"); }); }}>
            <label>Temperature<select name="temperature" defaultValue={household.temperatureUnit}><option value="fahrenheit">Fahrenheit · °F</option><option value="celsius">Celsius · °C</option></select></label>
            <label>Household timezone<select name="timezone" defaultValue={household.timezone}><option value="America/New_York">Eastern Time</option><option value="America/Chicago">Central Time</option><option value="America/Denver">Mountain Time</option><option value="America/Los_Angeles">Pacific Time</option><option value="Europe/London">London</option><option value="Europe/Paris">Central European Time</option></select></label>
            <label>Week starts<select disabled><option>Monday</option></select></label>
            <button className="button button-primary" disabled={pending}>Save preferences</button>
          </form>
        </section>
      </div>
    </div>
  );
}

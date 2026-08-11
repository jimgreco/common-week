"use client";

import { useState, useTransition } from "react";
import { Check, LoaderCircle, MapPin, Plus, Search, Trash2, UserPlus } from "lucide-react";
import {
  addLocationAction,
  inviteMemberAction,
  removeLocationAction,
  setDefaultLocationAction,
  updateCalendarPreferenceAction,
  updateHouseholdAction,
} from "@/app/actions/settings";
import { signInWithGoogle } from "@/app/actions/auth";
import { searchLocationsAction } from "@/app/actions/planner";
import type { CalendarPreference, GeocodingResult, HouseholdLocation, HouseholdMember, HouseholdSummary } from "@/types/domain";

interface Invitation { id: string; email: string; status: string; expiresAt: string; }

export function SettingsPanel({
  household,
  members,
  invitations,
  locations: initialLocations,
  calendars: initialCalendars,
  isDemo,
}: {
  household: HouseholdSummary;
  members: HouseholdMember[];
  invitations: Invitation[];
  locations: HouseholdLocation[];
  calendars: CalendarPreference[];
  isDemo: boolean;
}) {
  const [locations, setLocations] = useState(initialLocations);
  const [calendars, setCalendars] = useState(initialCalendars);
  const [locationQuery, setLocationQuery] = useState("");
  const [locationResults, setLocationResults] = useState<GeocodingResult[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const showMessage = (value: string) => { setMessage(value); window.setTimeout(() => setMessage(null), 4000); };

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
          <header><p className="eyebrow">Calendars</p><h2>Choose the scheduled commitments you see</h2><p>Read-only. Common Week never creates, edits, or deletes Google Calendar events.</p></header>
          {calendars.length ? <div className="calendar-settings-list">{calendars.map((calendar) => (
            <div className="calendar-setting" key={calendar.id}>
              <button className={`toggle ${calendar.isSelected ? "is-on" : ""}`} type="button" aria-label={`${calendar.isSelected ? "Hide" : "Show"} ${calendar.calendarName}`} onClick={() => { const next = calendars.map((candidate) => candidate.id === calendar.id ? { ...candidate, isSelected: !candidate.isSelected } : candidate); setCalendars(next); if (!isDemo) startTransition(async () => { const result = await updateCalendarPreferenceAction({ id: calendar.id, isSelected: !calendar.isSelected, displayAlias: calendar.displayAlias }); if (!result.ok) { setCalendars(calendars); showMessage(result.error ?? "Calendar save failed"); } }); }}><i /></button>
              <span className="calendar-color" style={{ background: calendar.color }} /><div><strong>{calendar.calendarName}</strong>{calendar.isPrimary && <small>Primary</small>}</div>
              <input value={calendar.displayAlias ?? ""} placeholder="Display alias" aria-label={`Alias for ${calendar.calendarName}`} onChange={(event) => setCalendars((current) => current.map((candidate) => candidate.id === calendar.id ? { ...candidate, displayAlias: event.target.value || null } : candidate))} onBlur={(event) => { if (!isDemo) startTransition(async () => { await updateCalendarPreferenceAction({ id: calendar.id, isSelected: calendar.isSelected, displayAlias: event.target.value.trim() || null }); }); }} />
            </div>
          ))}</div> : <div className="empty-settings-state"><p>No Google Calendars are connected yet.</p>{!isDemo && <form action={signInWithGoogle}><button className="button button-primary" type="submit">Connect Google Calendar</button></form>} {isDemo && <span>Calendars appear here after Google setup.</span>}</div>}
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

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, Check, Clock, CloudRain, ExternalLink, EyeOff, LoaderCircle, MapPin, Pencil, Search, Sunrise, Sunset, Trash2, Wind, X } from "lucide-react";
import { searchLocationsAction } from "@/app/actions/planner";
import { addDateDays, formatDayName, formatEventTime, formatMobileDate, parseDateOnly } from "@/lib/date";
import { displayTemperature, temperatureSymbol, type TemperatureUnit } from "@/lib/temperature";
import { weatherLabel, weatherSymbol } from "@/lib/weather-codes";
import type { CalendarEvent, CalendarEventDraft, DayPlan, EditableCalendar, GeocodingResult, HouseholdLocation, PlanningItem } from "@/types/domain";

export type LocationSelection =
  | { kind: "saved"; location: HouseholdLocation }
  | { kind: "search"; result: GeocodingResult; name: string };

function locationResultName(result: GeocodingResult): string {
  return [result.name, result.admin1 ?? result.country].filter(Boolean).join(", ").slice(0, 120);
}

const demoLocationResults: GeocodingResult[] = [
  { id: "demo-boston", name: "Boston", admin1: "Massachusetts", country: "United States", latitude: 42.3601, longitude: -71.0589, timezone: "America/New_York" },
  { id: "demo-los-angeles", name: "Los Angeles", admin1: "California", country: "United States", latitude: 34.0522, longitude: -118.2437, timezone: "America/Los_Angeles" },
  { id: "demo-palm-beach", name: "Palm Beach", admin1: "Florida", country: "United States", latitude: 26.7056, longitude: -80.0364, timezone: "America/New_York" },
  { id: "demo-paris", name: "Paris", admin1: "Île-de-France", country: "France", latitude: 48.8566, longitude: 2.3522, timezone: "Europe/Paris" },
  { id: "demo-sag-harbor", name: "Sag Harbor", admin1: "New York", country: "United States", latitude: 41.0007, longitude: -72.2957, timezone: "America/New_York" },
];

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]";
    const initialFocus = panelRef.current?.querySelector<HTMLElement>("[data-modal-autofocus], [autofocus]")
      ?? panelRef.current?.querySelector<HTMLElement>(focusableSelector);
    initialFocus?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(focusableSelector)];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={panelRef} className={`modal-panel ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

function eventSchedule(event: CalendarEvent, timeZone: string): string {
  if (event.allDay) {
    const firstDay = event.start.slice(0, 10);
    const lastDay = addDateDays(event.end.slice(0, 10), -1);
    return firstDay === lastDay
      ? `All day · ${formatMobileDate(firstDay)}`
      : `All day · ${formatMobileDate(firstDay)}–${formatMobileDate(lastDay)}`;
  }
  const eventDate = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(event.start));
  return `${formatMobileDate(eventDate)} · ${formatEventTime(event.start, timeZone)}–${formatEventTime(event.end, timeZone)}`;
}

export function EventDetailDialog({
  event,
  timeZone,
  onClose,
  onHide,
  onEdit,
  onDelete,
}: {
  event: CalendarEvent;
  timeZone: string;
  onClose: () => void;
  onHide: (event: CalendarEvent) => Promise<string | null>;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (event: CalendarEvent) => Promise<string | null>;
}) {
  const [hiding, setHiding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Calendar event" onClose={onClose}>
      <div className="modal-body event-detail-body">
        <div className="event-detail-heading">
          <span className="calendar-attribution event-detail-badge" style={{ background: event.calendarColor }}>{event.attribution}</span>
          <div><h3>{event.title}</h3><span>{event.calendarAlias}</span></div>
        </div>
        <dl className="event-detail-list">
          <div><dt><Clock size={15} /><span className="sr-only">Time</span></dt><dd>{eventSchedule(event, timeZone)}</dd></div>
          {event.location && <div><dt><MapPin size={15} /><span className="sr-only">Location</span></dt><dd>{event.location}</dd></div>}
          <div><dt><CalendarDays size={15} /><span className="sr-only">Calendar</span></dt><dd className="event-calendar-detail"><span>{event.calendarAlias}</span>{event.googleUrl && <a href={event.googleUrl} target="_blank" rel="noreferrer">Open in Google <ExternalLink size={12} /></a>}</dd></div>
          {event.isConflict && <div className="event-conflict-detail"><dt><AlertTriangle size={15} /><span className="sr-only">Conflict</span></dt><dd><strong>Time conflict</strong><span>This event overlaps another scheduled event.</span></dd></div>}
        </dl>
        {event.description && <div className="event-description"><h4>Notes</h4><p>{event.description}</p></div>}
        {event.recurringEventId && event.canEdit && <p className="event-edit-note">Editing or deleting this event changes only this occurrence. Use Google Calendar to change the entire series.</p>}
        {!event.canEdit && <p className="event-edit-note">This event is read-only here. Calendar editing can be enabled in Settings; partner-owned and Google read-only calendars remain view-only.</p>}
        <div className="event-hide-note"><p>Hiding affects Week of Us for the household. It does not change Google Calendar, and you can restore the event in Settings.</p><button className="button button-danger-quiet" type="button" disabled={hiding} onClick={async () => { setHiding(true); setError(null); const result = await onHide(event); if (result) { setError(result); setHiding(false); } }}><EyeOff size={14} />{hiding ? "Hiding…" : "Hide from Week of Us"}</button></div>
        {error && <p className="location-picker-error" role="alert">{error}</p>}
        {confirmDelete && <div className="delete-confirmation" role="alert"><strong>{event.recurringEventId ? "Delete this occurrence from Google Calendar?" : "Delete this event from Google Calendar?"}</strong><span>This cannot be undone from Week of Us.</span><button className="button button-danger" type="button" disabled={deleting} onClick={async () => {
          setDeleting(true);
          setError(null);
          const deleteError = await onDelete(event);
          setDeleting(false);
          if (deleteError) setError(deleteError);
          else onClose();
        }}>{deleting ? "Deleting…" : event.recurringEventId ? "Yes, delete occurrence" : "Yes, delete from Google"}</button></div>}
      </div>
      <footer className="modal-footer split-footer event-detail-footer">
        {event.canEdit && <button className="button button-danger-quiet" type="button" disabled={deleting} onClick={() => setConfirmDelete((current) => !current)}><Trash2 size={13} />Delete</button>}
        <span>{event.canEdit && <button className="button button-secondary" type="button" disabled={deleting} onClick={() => onEdit(event)}><Pencil size={13} />Edit</button>}<button className="button button-primary" type="button" disabled={deleting} onClick={onClose}>Done</button></span>
      </footer>
    </Modal>
  );
}

function eventDateAndTime(value: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${byType.year}-${byType.month}-${byType.day}`, time: `${byType.hour}:${byType.minute}` };
}

function initialEventDraft(date: string, calendars: EditableCalendar[], timeZone: string, event?: CalendarEvent): CalendarEventDraft {
  if (!event) {
    return {
      requestId: crypto.randomUUID(),
      calendarPreferenceId: calendars[0]?.id ?? "",
      title: "",
      description: "",
      location: "",
      allDay: false,
      startDate: date,
      endDate: date,
      startTime: "09:00",
      endTime: "10:00",
    };
  }
  const start = event.allDay ? { date: event.start.slice(0, 10), time: "09:00" } : eventDateAndTime(event.start, timeZone);
  const end = event.allDay
    ? { date: addDateDays(event.end.slice(0, 10), -1), time: "10:00" }
    : eventDateAndTime(event.end, timeZone);
  return {
    requestId: crypto.randomUUID(),
    calendarPreferenceId: event.calendarPreferenceId ?? "",
    providerEventId: event.providerEventId,
    etag: event.etag,
    title: event.title,
    description: event.description ?? "",
    location: event.location ?? "",
    allDay: event.allDay,
    startDate: start.date,
    endDate: end.date,
    startTime: start.time,
    endTime: end.time,
  };
}

export function CalendarEventEditorDialog({
  date,
  event,
  calendars,
  timeZone,
  onClose,
  onSave,
  onDelete,
}: {
  date: string;
  event?: CalendarEvent;
  calendars: EditableCalendar[];
  timeZone: string;
  onClose: () => void;
  onSave: (draft: CalendarEventDraft) => Promise<string | null>;
  onDelete: (event: CalendarEvent) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState(() => initialEventDraft(date, calendars, timeZone, event));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = Boolean(event);

  return (
    <Modal title={editing ? event?.recurringEventId ? "Edit event occurrence" : "Edit Google event" : "Add Google event"} onClose={onClose}>
      <form onSubmit={async (submitEvent) => {
        submitEvent.preventDefault();
        setSaving(true);
        setError(null);
        const saveError = await onSave(draft);
        setSaving(false);
        if (saveError) setError(saveError);
        else onClose();
      }}>
        <div className="modal-body form-stack calendar-event-form">
          <label>Title<input data-modal-autofocus value={draft.title} required maxLength={1000} onChange={(change) => setDraft({ ...draft, title: change.target.value })} /></label>
          <label>Calendar<select value={draft.calendarPreferenceId} disabled={editing} onChange={(change) => setDraft({ ...draft, calendarPreferenceId: change.target.value })}>{calendars.map((calendar) => <option value={calendar.id} key={calendar.id}>{calendar.name}</option>)}</select></label>
          <label className="all-day-control"><input type="checkbox" checked={draft.allDay} onChange={(change) => setDraft({ ...draft, allDay: change.target.checked })} /><span>All-day event</span></label>
          <div className="event-date-row">
            <label>Starts<input type="date" value={draft.startDate} required onChange={(change) => setDraft({ ...draft, startDate: change.target.value, endDate: draft.endDate < change.target.value ? change.target.value : draft.endDate })} /></label>
            {!draft.allDay && <label>Time<input type="time" value={draft.startTime} required onChange={(change) => setDraft({ ...draft, startTime: change.target.value })} /></label>}
          </div>
          <div className="event-date-row">
            <label>Ends<input type="date" value={draft.endDate} min={draft.startDate} required onChange={(change) => setDraft({ ...draft, endDate: change.target.value })} /></label>
            {!draft.allDay && <label>Time<input type="time" value={draft.endTime} required onChange={(change) => setDraft({ ...draft, endTime: change.target.value })} /></label>}
          </div>
          <label>Location<input value={draft.location} maxLength={1000} placeholder="Optional" onChange={(change) => setDraft({ ...draft, location: change.target.value })} /></label>
          <label>Notes<textarea value={draft.description} maxLength={8192} placeholder="Optional" onChange={(change) => setDraft({ ...draft, description: change.target.value })} /></label>
          <p className="event-timezone-note">Times use the household timezone: {timeZone}</p>
          {event?.recurringEventId && <p className="event-edit-note">These changes apply only to this occurrence. Use Google Calendar to change the entire series.</p>}
          {error && <p className="location-picker-error" role="alert">{error}</p>}
          {confirmDelete && <div className="delete-confirmation" role="alert"><strong>{event?.recurringEventId ? "Delete this occurrence from Google Calendar?" : "Delete this event from Google Calendar?"}</strong><span>This cannot be undone from Week of Us.</span><button className="button button-danger" type="button" disabled={deleting} onClick={async () => {
            if (!event) return;
            setDeleting(true);
            setError(null);
            const deleteError = await onDelete(event);
            setDeleting(false);
            if (deleteError) setError(deleteError);
            else onClose();
          }}>{deleting ? "Deleting…" : event?.recurringEventId ? "Yes, delete occurrence" : "Yes, delete from Google"}</button></div>}
        </div>
        <footer className="modal-footer split-footer">
          <span>{editing && <button className="button button-danger-quiet" type="button" disabled={saving || deleting} onClick={() => setConfirmDelete((current) => !current)}><Trash2 size={14} />Delete from Google</button>}</span>
          <span><button className="button button-secondary" type="button" disabled={saving || deleting} onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={saving || deleting || !draft.calendarPreferenceId || !draft.title.trim()}>{saving && <LoaderCircle className="spin" size={14} />}{saving ? "Saving…" : editing ? "Save changes" : "Add event"}</button></span>
        </footer>
      </form>
    </Modal>
  );
}

export function LocationDialog({
  date,
  locations,
  currentLocationId,
  isDemo,
  onClose,
  onSave,
}: {
  date: string;
  locations: HouseholdLocation[];
  currentLocationId: string | null;
  isDemo: boolean;
  onClose: () => void;
  onSave: (selection: LocationSelection, scope: "day" | "through-sunday" | "week") => Promise<string | null>;
}) {
  const [locationId, setLocationId] = useState(currentLocationId ?? locations[0]?.id ?? "");
  const [scope, setScope] = useState<"day" | "through-sunday" | "week">("day");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<GeocodingResult | null>(null);
  const [activeResult, setActiveResult] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const resultsId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const selectedSavedLocation = locations.find((location) => location.id === locationId) ?? null;
  const selection: LocationSelection | null = selectedResult
    ? { kind: "search", result: selectedResult, name: locationResultName(selectedResult) }
    : selectedSavedLocation
      ? { kind: "saved", location: selectedSavedLocation }
      : null;

  useEffect(() => {
    const trimmed = query.trim();
    if (selectedResult && query === locationResultName(selectedResult)) return;
    if (trimmed.length < 2) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      const response = isDemo
        ? { ok: true, data: demoLocationResults.filter((result) => locationResultName(result).toLowerCase().includes(trimmed.toLowerCase())) }
        : await searchLocationsAction(trimmed);
      if (cancelled) return;
      const nextResults = response.data ?? [];
      setResults(nextResults);
      setActiveResult(nextResults.length ? 0 : -1);
      setSearchError(response.ok ? null : response.error ?? "Location search is temporarily unavailable.");
      setSearching(false);
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isDemo, query, selectedResult]);

  const chooseResult = (result: GeocodingResult) => {
    setSelectedResult(result);
    setLocationId("");
    setQuery(locationResultName(result));
    setResults([]);
    setActiveResult(-1);
    setSearchError(null);
    setSaveError(null);
    searchInputRef.current?.focus();
  };

  return (
    <Modal title={`Set location · ${formatDayName(date, "long")}`} onClose={onClose}>
      <div className="modal-body">
        <fieldset className="choice-list location-choice-list">
          <legend>Location</legend>
          <div className="location-autocomplete">
            <label className="location-autocomplete-field" htmlFor={`${resultsId}-input`}>
              <Search size={15} />
              <input
                ref={searchInputRef}
                id={`${resultsId}-input`}
                value={query}
                role="combobox"
                aria-label="Search for a city or place"
                aria-autocomplete="list"
                aria-expanded={results.length > 0}
                aria-controls={resultsId}
                aria-activedescendant={activeResult >= 0 ? `${resultsId}-${activeResult}` : undefined}
                autoComplete="off"
                data-modal-autofocus
                placeholder="Search city or place…"
                onChange={(event) => {
                  const nextQuery = event.target.value;
                  setQuery(nextQuery);
                  setSelectedResult(null);
                  setSaveError(null);
                  if (nextQuery.trim().length < 2) {
                    setResults([]);
                    setActiveResult(-1);
                    setSearchError(null);
                    setSearching(false);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" && results.length) {
                    event.preventDefault();
                    setActiveResult((current) => (current + 1) % results.length);
                  } else if (event.key === "ArrowUp" && results.length) {
                    event.preventDefault();
                    setActiveResult((current) => current <= 0 ? results.length - 1 : current - 1);
                  } else if (event.key === "Enter" && activeResult >= 0 && results[activeResult]) {
                    event.preventDefault();
                    chooseResult(results[activeResult]);
                  } else if (event.key === "Escape" && results.length) {
                    event.preventDefault();
                    event.stopPropagation();
                    setResults([]);
                    setActiveResult(-1);
                  }
                }}
              />
              {searching && <LoaderCircle className="spin" size={15} aria-label="Searching locations" />}
            </label>
            {results.length > 0 && (
              <div className="location-autocomplete-results" id={resultsId} role="listbox" aria-label="Location suggestions">
                {results.map((result, index) => (
                  <button
                    id={`${resultsId}-${index}`}
                    className={index === activeResult ? "is-active" : ""}
                    type="button"
                    role="option"
                    aria-selected={index === activeResult}
                    key={`${result.id}-${result.latitude}-${result.longitude}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseResult(result)}
                  >
                    <MapPin size={14} />
                    <span><strong>{result.name}</strong><small>{[result.admin1, result.country].filter(Boolean).join(", ")}</small></span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {searchError && <p className="location-picker-error" role="status">{searchError}</p>}
          {selectedResult && (
            <div className="selected-search-location" aria-live="polite">
              <Check size={14} />
              <span><strong>{selectedResult.name}</strong><small>{[selectedResult.admin1, selectedResult.country].filter(Boolean).join(", ")}</small></span>
              <em>Selected</em>
            </div>
          )}
          {locations.length > 0 && <p className="saved-location-label">Saved locations</p>}
          {locations.map((location) => (
            <label key={location.id}>
              <input type="radio" name="location" value={location.id} checked={!selectedResult && locationId === location.id} onChange={() => { setLocationId(location.id); setSelectedResult(null); setQuery(""); setResults([]); setSaveError(null); }} />
              <span><MapPin size={14} />{location.name}{location.isDefault && <small>Default</small>}</span>
            </label>
          ))}
          {!locations.length && <p className="location-picker-hint">Search above to add the first household location.</p>}
        </fieldset>
        <fieldset className="choice-list compact-choices">
          <legend>Apply to</legend>
          <label><input type="radio" name="scope" checked={scope === "day"} onChange={() => setScope("day")} /><span>This day</span></label>
          <label><input type="radio" name="scope" checked={scope === "through-sunday"} onChange={() => setScope("through-sunday")} /><span>This day through Sunday</span></label>
          <label><input type="radio" name="scope" checked={scope === "week"} onChange={() => setScope("week")} /><span>Entire week</span></label>
        </fieldset>
        {saveError && <p className="location-picker-error" role="alert">{saveError}</p>}
      </div>
      <footer className="modal-footer">
        <button className="button button-secondary" type="button" onClick={onClose}>Cancel</button>
        <button
          className="button button-primary"
          type="button"
          disabled={!selection || saving}
          onClick={async () => {
            if (!selection) return;
            setSaving(true);
            setSaveError(null);
            const error = await onSave(selection, scope);
            if (error) setSaveError(error);
            setSaving(false);
          }}
        >
          {saving && <LoaderCircle className="spin" size={14} />}{saving ? "Saving…" : "Set location"}
        </button>
      </footer>
    </Modal>
  );
}

export function WeatherDialog({ day, timeZone, temperatureUnit, onClose }: { day: DayPlan; timeZone: string; temperatureUnit: TemperatureUnit; onClose: () => void }) {
  const weather = day.weather;
  if (!weather || weather.status !== "available") return null;
  const daytime = weather.hourly.filter((hour) => {
    const hourValue = Number(hour.time.slice(11, 13));
    return hourValue >= 7 && hourValue <= 21;
  });
  return (
    <Modal title={`${formatMobileDate(day.date)} · ${day.location?.name ?? "Weather"}`} onClose={onClose} wide>
      <div className="weather-detail-summary">
        <div className="weather-detail-primary">
          <span className="weather-detail-symbol" aria-hidden="true">{weatherSymbol(weather.conditionCode)}</span>
          <span className="weather-detail-copy"><strong>{displayTemperature(weather.highF, temperatureUnit)}° / {displayTemperature(weather.lowF, temperatureUnit)}°</strong><span>{weatherLabel(weather.conditionCode)} · {temperatureSymbol(temperatureUnit)}</span></span>
        </div>
        <div><CloudRain size={16} /><strong>{weather.precipitationProbability}%</strong><span>{weather.precipitationAmount.toFixed(2)} in</span></div>
        <div><Wind size={16} /><strong>{weather.windSpeedMph} mph</strong><span>Peak wind</span></div>
      </div>
      <div className="hourly-scroll" aria-label="Hourly forecast">
        {daytime.map((hour) => {
          const rainHeight = Math.max(2, hour.precipitationProbability * 0.42);
          return (
            <div className="hour-cell" key={hour.time}>
              <time>{formatEventTime(hour.time, timeZone)}</time>
              <span aria-hidden="true">{weatherSymbol(hour.conditionCode)}</span>
              <strong>{displayTemperature(hour.temperatureF, temperatureUnit)}°</strong>
              <div className="rain-bar-track" title={`${hour.precipitationProbability}% precipitation`}><i style={{ height: rainHeight }} /></div>
              <small>{hour.precipitationProbability}%</small>
            </div>
          );
        })}
      </div>
      <div className="sun-row">
        <span><Sunrise size={15} /> Sunrise {weather.sunrise ? formatEventTime(weather.sunrise, timeZone) : "—"}</span>
        <span><Sunset size={15} /> Sunset {weather.sunset ? formatEventTime(weather.sunset, timeZone) : "—"}</span>
      </div>
    </Modal>
  );
}

export function ItemEditorDialog({
  item,
  weekDates,
  onClose,
  onSave,
  onDelete,
}: {
  item: PlanningItem;
  weekDates: string[];
  onClose: () => void;
  onSave: (item: PlanningItem) => void;
  onDelete: (item: PlanningItem) => void;
}) {
  const [draft, setDraft] = useState(item);
  return (
    <Modal title="Edit planning item" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.text.trim()) return;
          onSave({ ...draft, text: draft.text.trim() });
        }}
      >
        <div className="modal-body form-stack">
          <label>Text<textarea autoFocus value={draft.text} maxLength={1000} onChange={(event) => setDraft({ ...draft, text: event.target.value })} /></label>
          <div className="form-row">
            <label>Type<select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as "note" | "task" })}><option value="note">Note</option><option value="task">Task</option></select></label>
          </div>
          <label>When<select value={draft.planningDate ?? "weekly"} onChange={(event) => setDraft({ ...draft, planningDate: event.target.value === "weekly" ? null : event.target.value })}><option value="weekly">This week</option>{weekDates.map((date) => <option value={date} key={date}>{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(parseDateOnly(date))}</option>)}</select></label>
          {item.createdByName && <p className="attribution-note">Added by {item.createdByName}</p>}
        </div>
        <footer className="modal-footer split-footer">
          <button className="button button-danger-quiet" type="button" onClick={() => onDelete(item)}><Trash2 size={14} /> Delete</button>
          <span><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">Save changes</button></span>
        </footer>
      </form>
    </Modal>
  );
}

export function SearchDialog({
  results,
  query,
  loading,
  onQuery,
  onClose,
}: {
  results: PlanningItem[];
  query: string;
  loading: boolean;
  onQuery: (query: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Search plans and tasks" onClose={onClose}>
      <div className="modal-body search-modal-body">
        <label className="search-field"><Search size={16} /><input autoFocus value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search household planning…" /></label>
        <div className="search-results" aria-live="polite">
          {loading && <p className="empty-section">Searching…</p>}
          {!loading && query.length >= 2 && !results.length && <p className="empty-section">No matching plans or tasks.</p>}
          {results.map((item) => (
            <a href={`/planner?week=${item.weekStartDate}`} className="search-result" key={item.id}>
              <span>{item.type === "task" ? (item.isCompleted ? "☑" : "□") : "•"}</span>
              <div><strong>{item.text}</strong><small>{item.planningDate ? formatMobileDate(item.planningDate) : `Week of ${item.weekStartDate}`}</small></div>
            </a>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export type LocationSearchResult = GeocodingResult;

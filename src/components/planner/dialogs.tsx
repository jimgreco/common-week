"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, CloudRain, LoaderCircle, MapPin, Search, Sunrise, Sunset, Trash2, Wind, X } from "lucide-react";
import { searchLocationsAction } from "@/app/actions/planner";
import { formatDayName, formatEventTime, formatMobileDate, parseDateOnly } from "@/lib/date";
import { displayTemperature, temperatureSymbol, type TemperatureUnit } from "@/lib/temperature";
import { weatherLabel, weatherSymbol } from "@/lib/weather-codes";
import type { DayPlan, GeocodingResult, HouseholdLocation, PlanningCategory, PlanningItem } from "@/types/domain";

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
        <span className="weather-detail-symbol" aria-hidden="true">{weatherSymbol(weather.conditionCode)}</span>
        <div><strong>{displayTemperature(weather.highF, temperatureUnit)}° / {displayTemperature(weather.lowF, temperatureUnit)}°</strong><span>{weatherLabel(weather.conditionCode)} · {temperatureSymbol(temperatureUnit)}</span></div>
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
  categories,
  onClose,
  onSave,
  onDelete,
}: {
  item: PlanningItem;
  weekDates: string[];
  categories: PlanningCategory[];
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
            <label>Category<select value={draft.categoryId ?? ""} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value || null })}><option value="">No category</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
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
              <div><strong>{item.text}</strong><small>{item.planningDate ? formatMobileDate(item.planningDate) : `Week of ${item.weekStartDate}`}{item.categoryName ? ` · ${item.categoryName}` : ""}</small></div>
            </a>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export type LocationSearchResult = GeocodingResult;

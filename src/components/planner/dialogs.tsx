"use client";

import { useEffect, useRef, useState } from "react";
import { CloudRain, MapPin, Search, Sunrise, Sunset, Trash2, Wind, X } from "lucide-react";
import { formatDayName, formatEventTime, formatMobileDate, parseDateOnly } from "@/lib/date";
import { displayTemperature, temperatureSymbol, type TemperatureUnit } from "@/lib/temperature";
import { weatherLabel, weatherSymbol } from "@/lib/weather-codes";
import type { DayPlan, GeocodingResult, HouseholdLocation, PlanningCategory, PlanningItem } from "@/types/domain";

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]";
    panelRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
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
  onClose,
  onSave,
}: {
  date: string;
  locations: HouseholdLocation[];
  currentLocationId: string | null;
  onClose: () => void;
  onSave: (locationId: string, scope: "day" | "through-sunday" | "week") => void;
}) {
  const [locationId, setLocationId] = useState(currentLocationId ?? locations[0]?.id ?? "");
  const [scope, setScope] = useState<"day" | "through-sunday" | "week">("day");
  return (
    <Modal title={`Set location · ${formatDayName(date, "long")}`} onClose={onClose}>
      <div className="modal-body">
        <fieldset className="choice-list">
          <legend>Location</legend>
          {locations.map((location) => (
            <label key={location.id}>
              <input type="radio" name="location" value={location.id} checked={locationId === location.id} onChange={() => setLocationId(location.id)} />
              <span><MapPin size={14} />{location.name}{location.isDefault && <small>Default</small>}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="choice-list compact-choices">
          <legend>Apply to</legend>
          <label><input type="radio" name="scope" checked={scope === "day"} onChange={() => setScope("day")} /><span>This day</span></label>
          <label><input type="radio" name="scope" checked={scope === "through-sunday"} onChange={() => setScope("through-sunday")} /><span>This day through Sunday</span></label>
          <label><input type="radio" name="scope" checked={scope === "week"} onChange={() => setScope("week")} /><span>Entire week</span></label>
        </fieldset>
        {!locations.length && <p className="inline-message">Add saved locations in Settings first.</p>}
      </div>
      <footer className="modal-footer">
        <button className="button button-secondary" type="button" onClick={onClose}>Cancel</button>
        <button className="button button-primary" type="button" disabled={!locationId} onClick={() => onSave(locationId, scope)}>Set location</button>
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

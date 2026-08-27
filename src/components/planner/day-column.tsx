import { AlertCircle, AlertTriangle, Check, CloudOff, MapPin, Plus, Umbrella } from "lucide-react";
import { formatDayName, formatDayNumber, formatEventTime, formatMobileDate, isToday } from "@/lib/date";
import { displayTemperature, temperatureSymbol, type TemperatureUnit } from "@/lib/temperature";
import { carryoverLabel } from "@/lib/task-carryover";
import { weatherLabel, weatherSymbol } from "@/lib/weather-codes";
import type { CalendarEvent, DayPlan, PlanningItem, PlannerSourceState } from "@/types/domain";

interface DayColumnProps {
  day: DayPlan;
  timeZone: string;
  temperatureUnit: TemperatureUnit;
  calendarState: PlannerSourceState;
  weatherState: PlannerSourceState;
  onAdd: (date: string, text: string, type: "note" | "task") => void;
  onToggle: (item: PlanningItem, completed: boolean) => void;
  onEdit: (item: PlanningItem) => void;
  onRetry: (item: PlanningItem) => void;
  onLocation: (date: string) => void;
  onWeather: (day: DayPlan) => void;
  onEvent: (event: CalendarEvent) => void;
  onAddEvent: (date: string) => void;
  canAddEvent: boolean;
}

function eventTimeLabel(event: CalendarEvent, timeZone: string): string {
  if (event.allDay) return "All day";
  const start = formatEventTime(event.start, timeZone);
  const end = formatEventTime(event.end, timeZone);
  const period = end.match(/ (AM|PM)$/)?.[0];
  return period && start.endsWith(period)
    ? `${start.slice(0, -period.length)}–${end}`
    : `${start}–${end}`;
}

function CalendarEventRows({
  events,
  timeZone,
  onEvent,
}: {
  events: CalendarEvent[];
  timeZone: string;
  onEvent: (event: CalendarEvent) => void;
}) {
  return (
    <div className="section-content event-list">
      {events.map((event) => (
        <button className={`calendar-event ${event.isConflict ? "has-conflict" : ""}`} type="button" onClick={() => onEvent(event)} aria-label={`${event.title}, ${eventTimeLabel(event, timeZone)}. Open details.`} key={event.id}>
          <span className="calendar-attribution" style={{ background: event.calendarColor }} title={event.calendarAlias}>
            {event.attribution}
          </span>
          <span className="event-copy"><span className="event-time">{eventTimeLabel(event, timeZone)}</span><span className="event-title" title={event.title}>{event.title}</span>{event.location && <span className="event-location">{event.location}</span>}</span>
          {event.isConflict && <span className="conflict-mark" title="Time conflict: overlaps another event" aria-label="Time conflict"><AlertTriangle size={10} aria-hidden="true" /></span>}
        </button>
      ))}
    </div>
  );
}

function InlinePlanningAdd({
  date,
  type,
  onAdd,
}: {
  date: string;
  type: "note" | "task";
  onAdd: DayColumnProps["onAdd"];
}) {
  const label = type === "note" ? "plan" : "task";
  return (
    <form
      className={`inline-planning-add inline-${type}-add`}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        const input = event.currentTarget.elements.namedItem("text");
        if (input instanceof HTMLInputElement) input.focus();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const text = String(data.get("text") ?? "").trim();
        if (!text) return;
        onAdd(date, text, type);
        form.reset();
      }}
    >
      {type === "note"
        ? <Plus className="inline-add-symbol" size={13} aria-hidden="true" />
        : <span className="inline-task-checkbox" aria-hidden="true" />}
      <input
        aria-label={`Add a ${label} for ${formatMobileDate(date)}`}
        name="text"
        placeholder={`Add a ${label}…`}
        maxLength={1000}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.currentTarget.blur();
        }}
      />
      <button type="submit" aria-label={`Save ${label}`}>Add</button>
    </form>
  );
}

export function PlanningItemRow({
  item,
  onToggle,
  onEdit,
  onRetry,
}: {
  item: PlanningItem;
  onToggle: DayColumnProps["onToggle"];
  onEdit: DayColumnProps["onEdit"];
  onRetry: DayColumnProps["onRetry"];
}) {
  const carriedFrom = carryoverLabel(item);
  return (
    <div className={`planning-row ${item.isCompleted ? "is-complete" : ""} ${item.saveState === "failed" ? "has-save-error" : ""}`} role={item.saveState === "failed" ? "alert" : undefined}>
      {item.type === "task" ? (
        <button
          className={`task-checkbox ${item.isCompleted ? "checked" : ""}`}
          type="button"
          onClick={() => onToggle(item, !item.isCompleted)}
          aria-label={`${item.isCompleted ? "Mark incomplete" : "Complete"}: ${item.text}`}
        >
          {item.isCompleted && <Check size={11} strokeWidth={3} aria-hidden="true" />}
        </button>
      ) : (
        <span className="note-bullet" aria-hidden="true" />
      )}
      <button className="planning-row-body" type="button" onClick={() => onEdit(item)}>
        <span className="planning-row-text">{item.text}</span>
        {carriedFrom && <span className="carryover-label">{carriedFrom}</span>}
      </button>
      {item.saveState === "saving" && <span className="save-indicator">Saving</span>}
      {item.saveState === "failed" && (
        <button className="retry-button" type="button" onClick={() => onRetry(item)} title="Retry save">
          <AlertCircle size={13} aria-hidden="true" /> Retry
        </button>
      )}
    </div>
  );
}

export function DayColumn({
  day,
  timeZone,
  temperatureUnit,
  calendarState,
  weatherState,
  onAdd,
  onToggle,
  onEdit,
  onRetry,
  onLocation,
  onWeather,
  onEvent,
  onAddEvent,
  canAddEvent,
}: DayColumnProps) {
  const notes = day.items.filter((item) => item.type === "note");
  const tasks = day.items.filter((item) => item.type === "task");
  const calendarGroups = [
    { id: "critical", label: "Critical", events: day.events.filter((event) => event.sectionGroup === "critical") },
    { id: "supplemental", label: "Supplemental", events: day.events.filter((event) => event.sectionGroup === "supplemental") },
  ].filter((group) => group.events.length > 0);
  const today = isToday(day.date, timeZone);
  const weather = day.weather;
  const unitLabel = temperatureSymbol(temperatureUnit);

  return (
    <article className={`day-column ${today ? "is-today" : ""}`} data-date={day.date}>
      <header className="day-header">
        <div className="day-date desktop-day-date">
          <span>{formatDayName(day.date)}</span>
          <strong>{formatDayNumber(day.date)}</strong>
          {today && <i>Today</i>}
        </div>
        <div className="day-date mobile-day-date">
          <strong>{formatMobileDate(day.date)}</strong>
          {today && <i>Today</i>}
        </div>
        <button className="location-button" type="button" onClick={() => onLocation(day.date)}>
          <MapPin size={12} aria-hidden="true" />
          <span>{day.location?.name ?? "Set location"}</span>
          <span aria-hidden="true">⌄</span>
        </button>
        {weather?.status === "available" ? (
          <button
            className="weather-button"
            type="button"
            onClick={() => onWeather(day)}
            aria-label={`${weatherLabel(weather.conditionCode)}, high ${displayTemperature(weather.highF, temperatureUnit)}${unitLabel}, low ${displayTemperature(weather.lowF, temperatureUnit)}${unitLabel}, ${weather.precipitationProbability}% rain. Open hourly forecast.`}
          >
            <span className="weather-symbol" aria-hidden="true">{weatherSymbol(weather.conditionCode)}</span>
            <strong>{displayTemperature(weather.highF, temperatureUnit)}°</strong>
            <span>/ {displayTemperature(weather.lowF, temperatureUnit)}°</span>
            <span className={weather.precipitationProbability >= 40 ? "rain-risk" : ""}>
              <Umbrella size={11} aria-hidden="true" /> {weather.precipitationProbability}%
            </span>
          </button>
        ) : (
          <div className="weather-unavailable">
            <CloudOff size={12} aria-hidden="true" />
            {weather?.status === "unavailable"
              ? "Forecast not yet available"
              : weatherState.status === "error"
                ? "Weather unavailable"
                : day.location
                  ? "Loading weather"
                  : "Set location for weather"}
          </div>
        )}
      </header>

      <section className="day-section calendar-section" aria-label={`Calendar for ${formatMobileDate(day.date)}`}>
        {calendarGroups.length ? calendarGroups.map((group) => (
          <div className={`calendar-event-group is-${group.id}`} key={group.id}>
            <h2>{group.label}</h2>
            <CalendarEventRows events={group.events} timeZone={timeZone} onEvent={onEvent} />
          </div>
        )) : <><h2>Calendar</h2><p className="empty-section">{calendarState.status === "loading" ? "Loading calendar" : "No events"}</p></>}
        {canAddEvent && <button className="calendar-quick-add" type="button" onClick={() => onAddEvent(day.date)}><Plus size={12} />Add event</button>}
      </section>

      <section className="day-section plans-section" aria-label={`Plans for ${formatMobileDate(day.date)}`}>
        <h2>Plans</h2>
        <div className="section-content">
          {notes.map((item) => (
            <PlanningItemRow item={item} onToggle={onToggle} onEdit={onEdit} onRetry={onRetry} key={item.id} />
          ))}
          <InlinePlanningAdd date={day.date} type="note" onAdd={onAdd} />
        </div>
      </section>

      <section className="day-section tasks-section" aria-label={`Tasks for ${formatMobileDate(day.date)}`}>
        <h2>Tasks</h2>
        <div className="section-content">
          {tasks.map((item) => (
            <PlanningItemRow item={item} onToggle={onToggle} onEdit={onEdit} onRetry={onRetry} key={item.id} />
          ))}
          <InlinePlanningAdd date={day.date} type="task" onAdd={onAdd} />
        </div>
      </section>
    </article>
  );
}

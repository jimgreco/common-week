import { AlertCircle, Check, CloudOff, MapPin, Plus, Umbrella } from "lucide-react";
import { formatDayName, formatDayNumber, formatEventTime, formatMobileDate, isToday } from "@/lib/date";
import { displayTemperature, temperatureSymbol, type TemperatureUnit } from "@/lib/temperature";
import { weatherLabel, weatherSymbol } from "@/lib/weather-codes";
import type { DayPlan, PlanningCategory, PlanningItem, PlannerSourceState } from "@/types/domain";

interface DayColumnProps {
  day: DayPlan;
  categories: PlanningCategory[];
  timeZone: string;
  temperatureUnit: TemperatureUnit;
  calendarState: PlannerSourceState;
  weatherState: PlannerSourceState;
  onAdd: (date: string, text: string, type: "note" | "task", categoryId: string | null) => void;
  onToggle: (item: PlanningItem, completed: boolean) => void;
  onEdit: (item: PlanningItem) => void;
  onRetry: (item: PlanningItem) => void;
  onLocation: (date: string) => void;
  onWeather: (day: DayPlan) => void;
}

function QuickAdd({
  date,
  categories,
  onAdd,
}: {
  date: string;
  categories: PlanningCategory[];
  onAdd: DayColumnProps["onAdd"];
}) {
  return (
    <form
      className="quick-add"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const text = String(data.get("text") ?? "").trim();
        if (!text) return;
        onAdd(
          date,
          text,
          data.get("type") === "task" ? "task" : "note",
          String(data.get("category") || "") || null,
        );
        form.reset();
      }}
    >
      <Plus size={13} aria-hidden="true" />
      <input aria-label={`Add a plan for ${formatMobileDate(date)}`} name="text" placeholder="Add a plan…" maxLength={1000} />
      <select aria-label="Item category" name="category" defaultValue="">
        <option value="">No category</option>
        {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
      </select>
      <select aria-label="Item type" name="type" defaultValue="note">
        <option value="note">Note</option>
        <option value="task">Task</option>
      </select>
      <button type="submit" aria-label="Save item">Add</button>
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
        <span className="note-bullet" style={{ background: item.categoryColor ?? undefined }} aria-hidden="true" />
      )}
      <button className="planning-row-body" type="button" onClick={() => onEdit(item)}>
        <span className="planning-row-text">{item.text}</span>
        {item.categoryName && <span className="category-label">{item.categoryName}</span>}
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
  categories,
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
}: DayColumnProps) {
  const notes = day.items.filter((item) => item.type === "note");
  const tasks = day.items.filter((item) => item.type === "task");
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
        <h2>Calendar</h2>
        <div className="section-content event-list">
          {day.events.length ? day.events.map((event) => (
            <div className={`calendar-event ${event.isConflict ? "has-conflict" : ""}`} key={event.id}>
              <span className="calendar-attribution" style={{ background: event.calendarColor }} title={event.calendarAlias}>
                {event.attribution}
              </span>
              <span className="event-time">{event.allDay ? "All day" : formatEventTime(event.start, timeZone)}</span>
              <span className="event-title" title={event.title}>{event.title}</span>
              {event.isConflict && <span className="conflict-mark" title="Overlaps another event">!</span>}
            </div>
          )) : <p className="empty-section">{calendarState.status === "loading" ? "Loading calendar" : "No events"}</p>}
        </div>
      </section>

      <section className="day-section plans-section" aria-label={`Plans for ${formatMobileDate(day.date)}`}>
        <h2>Plans</h2>
        <div className="section-content">
          {notes.length ? notes.map((item) => (
            <PlanningItemRow item={item} onToggle={onToggle} onEdit={onEdit} onRetry={onRetry} key={item.id} />
          )) : <p className="empty-section">Nothing planned yet</p>}
        </div>
      </section>

      <section className="day-section tasks-section" aria-label={`Tasks for ${formatMobileDate(day.date)}`}>
        <h2>Tasks</h2>
        <div className="section-content">
          {tasks.length ? tasks.map((item) => (
            <PlanningItemRow item={item} onToggle={onToggle} onEdit={onEdit} onRetry={onRetry} key={item.id} />
          )) : <p className="empty-section">No tasks</p>}
        </div>
      </section>

      <QuickAdd date={day.date} categories={categories} onAdd={onAdd} />
    </article>
  );
}

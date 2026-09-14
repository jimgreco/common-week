"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { addDateDays } from "@/lib/date";
import { calendarSlot, calendarDayDifference, type CalendarSlot } from "@/lib/calendar-interactions";
import { formatDayName, formatDayNumber, todayInTimeZone } from "@/lib/date";
import { layoutTimelineEvents, minuteInTimeZone, timelineEventLabel } from "@/lib/calendar-timeline";
import type { CalendarEvent, DayPlan, PlannerSourceState } from "@/types/domain";

const hourHeight = 72;
const hours = Array.from({ length: 24 }, (_, hour) => hour);
const hourLabel = (hour: number) => `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;

export function CalendarTimeline({ days, timeZone, sourceState, onEvent, onDay, children, canCreate, onCreate, onMove }: {
  canCreate: boolean;
  onCreate: (slot: CalendarSlot) => void;
  onMove: (event: CalendarEvent, slot: CalendarSlot) => Promise<string | null>;
  children: ReactNode;
  days: DayPlan[];
  timeZone: string;
  sourceState: PlannerSourceState;
  onEvent: (event: CalendarEvent) => void;
  onDay: (date: string) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ date: string; minute: number | null; slot: CalendarSlot; title: string } | null>(null);
  const drag = useRef<{ event: CalendarEvent; x: number; y: number; active: boolean; offset: number; slot: CalendarSlot | null } | null>(null);
  const suppressClick = useRef(false);
  const movable = (event: CalendarEvent) => Boolean(event.canEdit && event.etag && event.calendarPreferenceId && event.providerEventId && !moving);
  const startDrag = (pointer: ReactPointerEvent<HTMLButtonElement>, event: CalendarEvent, date: string) => {
    suppressClick.current = false;
    if (!movable(event) || pointer.button !== 0) return;
    const originDate = event.allDay ? event.start.slice(0, 10) : formatInTimeZone(event.start, timeZone, "yyyy-MM-dd");
    const daysOffset = calendarDayDifference(originDate, date);
    const originalMinute = event.allDay ? 0 : minuteInTimeZone(new Date(event.start), timeZone);
    const column = pointer.currentTarget.closest<HTMLElement>(".timeline-day");
    const grabMinute = column ? (pointer.clientY - column.getBoundingClientRect().top) * 60 / hourHeight : 0;
    drag.current = { event, x: pointer.clientX, y: pointer.clientY, active: false, offset: event.allDay ? daysOffset : daysOffset * 1440 + grabMinute - originalMinute, slot: null };
    pointer.currentTarget.setPointerCapture(pointer.pointerId);
  };
  const moveDrag = (pointer: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || (!current.active && Math.hypot(pointer.clientX - current.x, pointer.clientY - current.y) < 6)) return;
    current.active = true;
    suppressClick.current = true;
    const viewport = scroll.current;
    if (viewport) {
      const rect = viewport.getBoundingClientRect();
      viewport.scrollBy({ top: pointer.clientY > rect.bottom - 35 ? 18 : pointer.clientY < rect.top + 90 ? -18 : 0,
        left: pointer.clientX > rect.right - 30 ? 18 : pointer.clientX < rect.left + 30 ? -18 : 0 });
    }
    const target = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest<HTMLElement>(current.event.allDay ? "[data-all-day-date]" : ".timeline-day");
    const date = target?.dataset.allDayDate ?? target?.dataset.date;
    if (!target || !date) { current.slot = null; setPreview(null); return; }
    const minute = current.event.allDay ? null : Math.max(0, Math.min(1425, Math.round((pointer.clientY - target.getBoundingClientRect().top) * 60 / hourHeight / 15) * 15));
    const slot = minute === null ? { date: addDateDays(date, -current.offset), minute: null } : calendarSlot(date, minute - current.offset);
    current.slot = slot;
    setPreview({ date, minute, slot, title: current.event.title });
  };
  const finishDrag = async () => {
    const current = drag.current;
    drag.current = null;
    setPreview(null);
    if (!current?.active || !current.slot) return;
    const unchanged = current.event.allDay ? current.slot.date === current.event.start.slice(0, 10)
      : current.slot.date === formatInTimeZone(current.event.start, timeZone, "yyyy-MM-dd") && current.slot.minute === minuteInTimeZone(new Date(current.event.start), timeZone);
    if (unchanged) return;
    setMoving(true); setMoveError(null);
    try { setMoveError(await onMove(current.event, current.slot)); }
    catch { setMoveError("The event could not be moved. Please try again."); }
    finally { setMoving(false); }
  };
  const dragHandlers = (event: CalendarEvent, date: string) => ({
    onPointerDown: (pointer: ReactPointerEvent<HTMLButtonElement>) => startDrag(pointer, event, date),
    onPointerMove: moveDrag, onPointerUp: () => void finishDrag(),
    onPointerCancel: () => { drag.current = null; setPreview(null); },
    onKeyDown: (key: React.KeyboardEvent<HTMLButtonElement>) => { if (key.key === "Escape") { drag.current = null; setPreview(null); } },
    onClick: () => { if (suppressClick.current) { suppressClick.current = false; return; } onEvent(event); },
  });
  const dateKey = days.map((day) => day.date).join(",");
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 7 * hourHeight;
  }, [dateKey]);
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = window.setTimeout(update, 0);
    const interval = window.setInterval(update, 60_000);
    return () => { window.clearTimeout(timer); window.clearInterval(interval); };
  }, []);
  const today = now ? todayInTimeZone(timeZone, now) : null;
  const count = days.reduce((sum, day) => sum + day.events.length, 0);
  return <section className="calendar-timeline" aria-label={`${days.length === 1 ? "Day" : "Week"} calendar timeline`}>
    <div className="timeline-caption"><span>Times in {timeZone.replaceAll("_", " ")}</span><span>Blank space is open time · Overlaps appear side by side</span></div>
    {canCreate && <p className="timeline-interaction-hint">Click an empty time to add an event · Drag editable events to move them · Repeating events move this occurrence only</p>}
    {moving && <p className="timeline-status" role="status">Saving event time…</p>}
    {moveError && <p className="timeline-move-error" role="alert">{moveError}</p>}
    {sourceState.status !== "ready" ? <p className="timeline-status" role="status">{sourceState.message ?? "Loading calendar…"} Open time may be incomplete.</p>
      : count === 0 && <p className="timeline-status" role="status">No events in this view. Your visible calendars leave this time open.</p>}
    <div className="timeline-workspace">
    <div className="timeline-scroll" ref={scroll}>
      <div className="timeline-grid" style={{ "--day-count": days.length, minWidth: days.length === 1 ? undefined : 1040 } as CSSProperties}>
        <div className="timeline-head timeline-corner">All day</div>
        {days.map((day) => <div className={`timeline-head ${day.date === today ? "is-today" : ""}`} key={day.date}>
          <button className="timeline-day-label" onClick={() => onDay(day.date)}>{formatDayName(day.date)} {formatDayNumber(day.date)}</button>
          <div className="timeline-all-day" data-all-day-date={day.date}>
            {day.events.filter((event) => event.allDay).map((event) => <button key={event.id} data-movable={movable(event)} {...dragHandlers(event, day.date)} style={{ borderLeftColor: event.calendarColor }} title={`${event.title} · All day · ${event.calendarAlias}`}>{event.title}</button>)}
            {canCreate && <button className="timeline-add-all-day" aria-label={`Add all-day event on ${day.date}`} onClick={() => onCreate({ date: day.date, minute: null })}>+</button>}
            {preview?.date === day.date && preview.minute === null && <span className="timeline-drop-all-day">Move to {preview.slot.date}</span>}
          </div>
        </div>)}
        <div className="timeline-hours" style={{ height: 24 * hourHeight }}>{hours.map((hour) => <span key={hour} style={{ top: hour * hourHeight }}>{hourLabel(hour)}</span>)}</div>
        {days.map((day) => <div className="timeline-day" data-date={day.date} key={day.date} style={{ height: 24 * hourHeight }}>
          {canCreate && <button className="timeline-create-surface" aria-label={`Add event on ${day.date}`} onClick={(click) => onCreate(calendarSlot(day.date, click.detail === 0 ? 540 : Math.min(1425, (click.clientY - click.currentTarget.getBoundingClientRect().top) * 60 / hourHeight)))} />}
          {hours.map((hour) => <div className="timeline-hour-rule" key={hour} style={{ top: hour * hourHeight, height: hourHeight }} />)}
          {layoutTimelineEvents(day.events, day.date, timeZone).map((block) => {
            const label = `${block.event.title} · ${timelineEventLabel(block.event, day.date, timeZone)} · ${block.event.calendarAlias}${block.overlaps ? " · Overlaps another visible event" : ""}`;
            return <button className="timeline-event" key={block.event.id} {...dragHandlers(block.event, day.date)} data-movable={movable(block.event)} aria-label={label} title={label}
              data-overlap={block.overlaps} style={{
                top: block.startMinute * hourHeight / 60,
                height: Math.max(18, (block.endMinute - block.startMinute) * hourHeight / 60) - 2,
                left: `calc(${100 * block.column / block.columnCount}% + 2px)`,
                width: `calc(${100 / block.columnCount}% - 4px)`,
                "--event-color": block.event.calendarColor,
              } as CSSProperties}>
              <strong>{block.event.title}</strong><span>{timelineEventLabel(block.event, day.date, timeZone)}</span>
              <span>{block.event.calendarAlias}{block.overlaps ? " · Overlap" : ""}</span>
            </button>;
          })}
          {preview?.date === day.date && preview.minute !== null && <div className="timeline-drop-preview" style={{ top: preview.minute * hourHeight / 60 }}>
            {preview.title} · {preview.slot.date} {String(Math.floor((preview.slot.minute ?? 0) / 60)).padStart(2, "0")}:{String((preview.slot.minute ?? 0) % 60).padStart(2, "0")}
          </div>}
          {day.date === today && now && <div className="timeline-now" aria-label="Current time" style={{ top: minuteInTimeZone(now, timeZone) * hourHeight / 60 }}><i /></div>}
        </div>)}
      </div>
    </div>
    {children}
    </div>
  </section>;
}

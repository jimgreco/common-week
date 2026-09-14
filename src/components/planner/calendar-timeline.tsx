"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { formatDayName, formatDayNumber, todayInTimeZone } from "@/lib/date";
import { layoutTimelineEvents, minuteInTimeZone, timelineEventLabel } from "@/lib/calendar-timeline";
import type { CalendarEvent, DayPlan, PlannerSourceState } from "@/types/domain";

const hourHeight = 72;
const hours = Array.from({ length: 24 }, (_, hour) => hour);
const hourLabel = (hour: number) => `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;

export function CalendarTimeline({ days, timeZone, sourceState, onEvent, onDay, children }: {
  children: ReactNode;
  days: DayPlan[];
  timeZone: string;
  sourceState: PlannerSourceState;
  onEvent: (event: CalendarEvent) => void;
  onDay: (date: string) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState<Date | null>(null);
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
    {sourceState.status !== "ready" ? <p className="timeline-status" role="status">{sourceState.message ?? "Loading calendar…"} Open time may be incomplete.</p>
      : count === 0 && <p className="timeline-status" role="status">No events in this view. Your visible calendars leave this time open.</p>}
    <div className="timeline-workspace">
    <div className="timeline-scroll" ref={scroll}>
      <div className="timeline-grid" style={{ "--day-count": days.length, minWidth: days.length === 1 ? undefined : 1040 } as CSSProperties}>
        <div className="timeline-head timeline-corner">All day</div>
        {days.map((day) => <div className={`timeline-head ${day.date === today ? "is-today" : ""}`} key={day.date}>
          <button className="timeline-day-label" onClick={() => onDay(day.date)}>{formatDayName(day.date)} {formatDayNumber(day.date)}</button>
          <div className="timeline-all-day">{day.events.filter((event) => event.allDay).map((event) => <button key={event.id} style={{ borderLeftColor: event.calendarColor }} onClick={() => onEvent(event)} title={`${event.title} · All day · ${event.calendarAlias}`}>{event.title}</button>)}</div>
        </div>)}
        <div className="timeline-hours" style={{ height: 24 * hourHeight }}>{hours.map((hour) => <span key={hour} style={{ top: hour * hourHeight }}>{hourLabel(hour)}</span>)}</div>
        {days.map((day) => <div className="timeline-day" data-date={day.date} key={day.date} style={{ height: 24 * hourHeight }}>
          {hours.map((hour) => <div className="timeline-hour-rule" key={hour} style={{ top: hour * hourHeight, height: hourHeight }} />)}
          {layoutTimelineEvents(day.events, day.date, timeZone).map((block) => {
            const label = `${block.event.title} · ${timelineEventLabel(block.event, day.date, timeZone)} · ${block.event.calendarAlias}${block.overlaps ? " · Overlaps another visible event" : ""}`;
            return <button className="timeline-event" key={block.event.id} onClick={() => onEvent(block.event)} aria-label={label} title={label}
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
          {day.date === today && now && <div className="timeline-now" aria-label="Current time" style={{ top: minuteInTimeZone(now, timeZone) * hourHeight / 60 }}><i /></div>}
        </div>)}
      </div>
    </div>
    {children}
    </div>
  </section>;
}

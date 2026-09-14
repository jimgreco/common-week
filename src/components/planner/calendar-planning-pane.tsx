"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { PlanningItemRow } from "./day-column";
import { formatMobileDate } from "@/lib/date";
import type { ChildProfile, DayPlan, PlanningItem, PlanningItemType } from "@/types/domain";

const subscribeToWidth = (notify: () => void) => {
  const query = window.matchMedia("(min-width: 768px)");
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
const isWide = () => window.matchMedia("(min-width: 768px)").matches;
const serverWidth = () => false;

export function CalendarPlanningPane({ days, weeklyItems, childProfiles, canEdit, onAdd, onToggle, onEdit, onRetry }: {
  days: DayPlan[];
  weeklyItems: PlanningItem[];
  childProfiles: ChildProfile[];
  canEdit: boolean;
  onAdd: (date: string | null, text: string, type: PlanningItemType) => void;
  onToggle: (item: PlanningItem, complete: boolean) => void;
  onEdit: (item: PlanningItem) => void;
  onRetry: (item: PlanningItem) => void;
}) {
  const wide = useSyncExternalStore(subscribeToWidth, isWide, serverWidth);
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const open = expanded ?? wide;
  const bodyId = useId();
  const [draft, setDraft] = useState<{ date: string | null; type: PlanningItemType; text: string } | null>(null);
  const groups = [...days.map((day) => ({ date: day.date as string | null, title: formatMobileDate(day.date), items: day.items })), { date: null, title: "This week", items: weeklyItems }];
  const items = groups.flatMap((group) => group.items);
  const tasksLeft = items.filter((item) => item.type === "task" && !item.isCompleted).length;
  const notes = items.filter((item) => item.type === "note").length;
  return <section className="calendar-planning-pane" aria-label="Calendar tasks and notes">
    <button className="calendar-planning-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setExpanded(!open)}>
      <span><strong>Tasks & Notes</strong><small>{tasksLeft} {tasksLeft === 1 ? "task" : "tasks"} left · {notes} {notes === 1 ? "note" : "notes"}</small></span>
      {open ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronUp size={18} aria-hidden="true" />}
    </button>
    <div id={bodyId} className="calendar-planning-body" hidden={!open}>
      <div className="calendar-planning-groups">
        {groups.map((group) => <section className="calendar-planning-group" aria-label={`${group.title} tasks and notes`} key={group.date ?? "week"}>
          <header><h3>{group.title}</h3>{group.date === null && <small>Flexible plans for the whole week</small>}</header>
          {group.items.length === 0 && <p className="calendar-planning-empty">No tasks or notes in this view.</p>}
          {group.items.map((item) => <PlanningItemRow key={item.id} item={item} childProfiles={childProfiles} canEdit={canEdit} onToggle={onToggle} onEdit={onEdit} onRetry={onRetry} />)}
          {canEdit && <div className="calendar-planning-add">
            {(["task", "note"] as const).map((type) => <button key={type} aria-label={`Add ${type} for ${group.title}`} onClick={() => setDraft({ date: group.date, type, text: "" })}><Plus size={12} aria-hidden="true" />{type === "task" ? "Task" : "Note"}</button>)}
          </div>}
          {canEdit && draft && draft.date === group.date && <form className="calendar-planning-capture" onSubmit={(event) => {
            event.preventDefault();
            const text = draft.text.trim();
            if (!text) return;
            onAdd(draft.date, text, draft.type);
            setDraft(null);
          }}>
            <input autoFocus aria-label={`New ${draft.type} for ${group.title}`} placeholder={`New ${draft.type}…`} maxLength={1000} value={draft.text} onChange={(event) => setDraft({ ...draft, text: event.target.value })} />
            <button type="submit" disabled={!draft.text.trim()}>Add</button>
            <button type="button" aria-label="Cancel quick add" onClick={() => setDraft(null)}><X size={14} /></button>
          </form>}
        </section>)}
      </div>
    </div>
  </section>;
}

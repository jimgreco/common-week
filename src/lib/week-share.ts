import type { WeeklyPlannerData } from "@/types/domain";
export interface WeekShareOptions {
  memberIds: string[];
  events: boolean;
  tasks: boolean;
  notes: boolean;
  privateCalendars: boolean;
}
export const defaultWeekShare: WeekShareOptions = {
  memberIds: [],
  events: true,
  tasks: true,
  notes: false,
  privateCalendars: false,
};
export function shareWeek(data: WeeklyPlannerData, options: WeekShareOptions) {
  const matches = (ids: string[]) =>
    !options.memberIds.length ||
    ids.some((id) => options.memberIds.includes(id));
  const items = (list: WeeklyPlannerData["weeklyItems"]) =>
    list.filter(
      (i) =>
        (i.type === "task" ? options.tasks : options.notes) &&
        matches([
          ...(i.assignedMemberIds ?? (i.childId ? [i.childId] : [])),
          ...(i.responsibleMemberId ? [i.responsibleMemberId] : []),
        ]),
    );
  return {
    ...data,
    weeklyItems: items(data.weeklyItems),
    days: data.days.map((day) => ({
      ...day,
      items: items(day.items),
      events: day.events.filter(
        (e) =>
          options.events &&
          matches(e.assignedMemberIds ?? []) &&
          (options.privateCalendars ||
            data.visibleCalendars.find((c) => c.id === e.calendarPreferenceId)
              ?.visibility === "share"),
      ),
    })),
  };
}
export function escapeHTML(text: string) {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function weekHTML(data: WeeklyPlannerData, options: WeekShareOptions) {
  const d = shareWeek(data, options);
  const esc = escapeHTML;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.household.name)} · ${esc(d.weekStart)}</title><style>@page{size:landscape;margin:12mm}body{font:14px system-ui;color:#243c35;margin:24px}.week-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}@media(max-width:700px){.week-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media print{body{font-size:11px;margin:0}.week-grid{gap:8px}h1{margin:0}h2{font-size:14px}}h1{font-size:28px}h2{font-size:18px;border-bottom:2px solid #bed0c4;padding-bottom:8px}section{break-inside:avoid;margin:0;padding:12px;background:#f4f7f2;min-width:0}ul{padding-left:18px}li{margin:8px 0;overflow-wrap:anywhere}small{color:#53645b}</style></head><body><h1>${esc(d.household.name)}</h1><p>Week of ${esc(d.weekStart)}</p><div class="week-grid">${d.weeklyItems.length ? `<section><h2>This week</h2><ul>${d.weeklyItems.map((i) => `<li>${i.type === "task" ? (i.isCompleted ? "☑ " : "☐ ") : ""}${esc(i.text)}</li>`).join("")}</ul></section>` : ""}${d.days.map((day) => `<section><h2>${esc(new Intl.DateTimeFormat("en-US", {timeZone:"UTC",weekday:"short",month:"short",day:"numeric"}).format(new Date(`${day.date}T12:00:00Z`)))}</h2><ul>${day.events.map((e) => `<li><strong>${esc(e.allDay ? "All day" : new Intl.DateTimeFormat("en-US", { timeZone: d.household.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(e.start)))}</strong> ${esc(e.title)}</li>`).join("")}${day.items.map((i) => `<li>${i.type === "task" ? (i.isCompleted ? "☑ " : "☐ ") : ""}${esc(i.text)}</li>`).join("")}</ul>${!day.events.length && !day.items.length ? "<small>Room to breathe.</small>" : ""}</section>`).join("")}</div></body></html>`;
}

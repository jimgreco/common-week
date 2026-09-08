"use client";

import type { ChildProfile, FamilyPlanningMutation, TaskRoutine } from "@/types/domain";

export const childColors = ["#5C7C67", "#946BA1", "#CC8655", "#537FA5", "#B65F7A", "#8B844A"];
export const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export type RoutineDraft = Omit<TaskRoutine, "id"> & { id?: string };
export type FamilyMutationHandler = (mutation: FamilyPlanningMutation) => Promise<string | null>;

export function ChildSelector({ childProfiles, value, onChange, label = "For" }: { childProfiles: ChildProfile[]; value: string | null; onChange: (id: string | null) => void; label?: string }) {
  if (!childProfiles.length) return null;
  return <label>{label}<select value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}><option value="">Whole household</option>{childProfiles.map((child) => <option value={child.id} key={child.id}>{child.name}</option>)}</select></label>;
}

export function ChildBadge({ child }: { child?: ChildProfile }) {
  return child ? <span className="child-badge"><i style={{ backgroundColor: child.color }} />{child.name}</span> : null;
}

export function routineDescription(routine: Pick<TaskRoutine, "frequency" | "interval" | "weekdays">): string {
  const cadence = routine.frequency === "daily"
    ? routine.interval === 1 ? "Every day" : `Every ${routine.interval} days`
    : routine.interval === 1 ? "Every week" : `Every ${routine.interval} weeks`;
  return `${cadence}${routine.weekdays.length ? ` · ${routine.weekdays.map((day) => weekdays[day]).join(", ")}` : routine.frequency === "weekly" ? " · any day" : ""}`;
}

export function RoutineFields({ value, onChange, childProfiles = [] }: { value: RoutineDraft; onChange: (value: RoutineDraft) => void; childProfiles?: ChildProfile[] }) {
  const preset = value.frequency === "daily" ? "daily" : value.weekdays.join(",") === "0,1,2,3,4" && value.interval === 1 ? "weekdays" : value.interval === 2 ? "alternate" : "weekly";
  return <div className="routine-fields form-stack">
    <label>Repeat<select value={preset} onChange={(event) => {
      const next = event.target.value;
      onChange({ ...value, frequency: next === "daily" ? "daily" : "weekly", interval: next === "alternate" ? 2 : 1, weekdays: next === "weekdays" ? [0, 1, 2, 3, 4] : next === "daily" ? [] : value.weekdays });
    }}><option value="daily">Every day</option><option value="weekdays">Every weekday</option><option value="weekly">Every week</option><option value="alternate">Every other week</option></select></label>
    <label>Repeat every<input type="number" min={1} max={52} required value={value.interval} onChange={(event) => onChange({ ...value, interval: Number(event.target.value) })} /><small>{value.frequency === "weekly" ? "weeks" : "days"}</small></label>
    <fieldset className="family-weekdays"><legend>Days <small>{value.frequency === "weekly" ? "Leave empty for an undated weekly task" : "Leave empty to include every day"}</small></legend><div>{weekdays.map((day, index) => <label key={day}><input type="checkbox" checked={value.weekdays.includes(index)} onChange={(event) => onChange({ ...value, weekdays: event.target.checked ? [...value.weekdays, index].sort() : value.weekdays.filter((candidate) => candidate !== index) })} /><span>{day}</span></label>)}</div></fieldset>
    <div className="form-row"><label>Starts<input type="date" required value={value.startsOn} onChange={(event) => onChange({ ...value, startsOn: event.target.value })} /></label><label>Ends <small>Optional</small><input type="date" min={value.startsOn} value={value.endsOn ?? ""} onChange={(event) => onChange({ ...value, endsOn: event.target.value || null })} /></label></div>
    <ChildSelector childProfiles={childProfiles} value={value.childId} onChange={(childId) => onChange({ ...value, childId })} />
  </div>;
}

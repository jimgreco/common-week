"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight, Circle, Copy, LoaderCircle, Plus, Repeat2, Trash2, Users } from "lucide-react";
import { Modal } from "@/components/planner/dialogs";
import { formatMobileDate, formatWeekRange } from "@/lib/date";
import type { ChildProfile, FamilyPlanningData, FamilyPlanningMutation, PlanningItem, TaskRoutine, WeeklyPlannerData } from "@/types/domain";

import { childColors, weekdays, ChildBadge, RoutineFields, routineDescription, type FamilyMutationHandler } from "@/components/planner/family-planning-fields";
export { RoutineFields } from "@/components/planner/family-planning-fields";
export type { RoutineDraft } from "@/components/planner/family-planning-fields";

function ChildEditor({ child, calendars, onSave, onCancel }: { child?: ChildProfile; calendars: WeeklyPlannerData["visibleCalendars"]; onSave: (child: ChildProfile) => Promise<string | null>; onCancel: () => void }) {
  const [draft, setDraft] = useState<ChildProfile>(() => child ?? { id: crypto.randomUUID(), name: "", color: childColors[0], calendarPreferenceIds: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <form className="family-editor form-stack" onSubmit={async (event) => { event.preventDefault(); if (!draft.name.trim()) return; setBusy(true); setError(null); const result = await onSave({ ...draft, name: draft.name.trim() }); setBusy(false); if (result) setError(result); else onCancel(); }}>
    <label>Child’s name<input autoFocus value={draft.name} maxLength={80} required placeholder="First name" onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <fieldset className="child-colors"><legend>Color</legend>{childColors.map((color, index) => <label key={color}><input type="radio" name="child-color" aria-label={`Color ${index + 1}`} checked={draft.color === color} onChange={() => setDraft({ ...draft, color })} /><span style={{ backgroundColor: color }}>{draft.color === color && <Check size={15} />}</span></label>)}</fieldset>
    <fieldset className="family-calendar-links"><legend>Link calendars <small>Optional</small></legend><p>Show these calendars when you filter the week by {draft.name || "this child"}. Calendar sharing stays the same.</p>{calendars.length ? calendars.map((calendar) => <label key={calendar.id}><input type="checkbox" checked={draft.calendarPreferenceIds.includes(calendar.id)} onChange={(event) => setDraft({ ...draft, calendarPreferenceIds: event.target.checked ? [...draft.calendarPreferenceIds, calendar.id] : draft.calendarPreferenceIds.filter((id) => id !== calendar.id) })} /><i style={{ backgroundColor: calendar.color }} />{calendar.name}</label>) : <p className="family-muted">Connect or share a calendar in Settings to link it here.</p>}</fieldset>
    {error && <p className="family-error" role="alert">{error}</p>}<div className="family-form-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={onCancel}>Cancel</button><button className="button button-primary" disabled={busy || !draft.name.trim()}>{busy && <LoaderCircle size={14} className="spin" />}{child ? "Save child" : "Add child"}</button></div>
  </form>;
}

function RoutineEditor({ routine, childProfiles, weekStart, onSave, onCancel }: { routine?: TaskRoutine; childProfiles: ChildProfile[]; weekStart: string; onSave: (routine: TaskRoutine) => Promise<string | null>; onCancel: () => void }) {
  const [draft, setDraft] = useState<TaskRoutine>(() => routine ?? { id: crypto.randomUUID(), text: "", childId: null, frequency: "weekly", interval: 1, weekdays: [], startsOn: weekStart, endsOn: null, active: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <form className="family-editor form-stack" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(null); const result = await onSave(draft); setBusy(false); if (result) setError(result); else onCancel(); }}>
    <label>Task<input autoFocus value={draft.text} maxLength={1000} required placeholder="Pack school bags" onChange={(event) => setDraft({ ...draft, text: event.target.value })} /></label>
    <RoutineFields value={draft} onChange={(value) => setDraft({ ...value, id: draft.id })} childProfiles={childProfiles} />
    <p className="family-muted">Each repetition is a separate shared task. Completed tasks stay in their original week.</p>
    {error && <p className="family-error" role="alert">{error}</p>}<div className="family-form-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={onCancel}>Cancel</button><button className="button button-primary" disabled={busy || !draft.text.trim()}>{busy && <LoaderCircle size={14} className="spin" />}{routine ? "Save routine" : "Create routine"}</button></div>
  </form>;
}

const steps = ["Carry forward", "Look ahead", "Routines", "Children", "Make a plan", "Review together"];

export function FamilyPlanningPanel({ family, data, items, onMutation, onClose, onToggle, onEdit, onMove, onEvent, initialStep = 0 }: {
  family: FamilyPlanningData;
  data: WeeklyPlannerData;
  items: PlanningItem[];
  onMutation: FamilyMutationHandler;
  onClose: () => void;
  onToggle: (item: PlanningItem, completed: boolean) => Promise<void>;
  onEdit: (item: PlanningItem) => void;
  onMove: (item: PlanningItem) => Promise<string | null>;
  onEvent: (event: WeeklyPlannerData["days"][number]["events"][number]) => void;
  initialStep?: number;
}) {
  const [step, setStep] = useState(initialStep);
  const [childEditor, setChildEditor] = useState<ChildProfile | "new" | null>(null);
  const [routineEditor, setRoutineEditor] = useState<TaskRoutine | "new" | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateId, setTemplateId] = useState(() => crypto.randomUUID());
  const [templateConfirm, setTemplateConfirm] = useState<string | null>(null);
  const [deleteChildConfirm, setDeleteChildConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reviewDraft, setReviewDraft] = useState(family.review);
  const [savedRevision, setSavedRevision] = useState(family.review.revision);
  const [lastReview, setLastReview] = useState(family.review);
  if (lastReview.revision !== family.review.revision) {
    if (reviewDraft.priorities === lastReview.priorities && reviewDraft.meals === lastReview.meals && reviewDraft.logistics === lastReview.logistics) {
      setReviewDraft(family.review);
      setSavedRevision(family.review.revision);
    }
    setLastReview(family.review);
  }
  const reviewDirty = reviewDraft.priorities !== family.review.priorities || reviewDraft.meals !== family.review.meals || reviewDraft.logistics !== family.review.logistics;
  const openItems = items.filter((item) => item.type === "task" && !item.isCompleted);
  const events = data.days.flatMap((day) => day.events).filter((event, index, all) => all.findIndex((other) => other.id === event.id) === index);
  const overlaps = events.filter((event) => event.isConflict);
  const reviewed = family.review.reviewedBy.some((member) => member.userId === family.currentUserId);
  const eligibleMembers = data.members.filter((member) => member.role !== "viewer");
  const apply = async (mutation: FamilyPlanningMutation, message?: string) => {
    setBusy(mutation.action); setError(null); setSuccess(null);
    let result: string | null;
    try { result = await onMutation(mutation); } catch { result = "This change could not be saved. Please try again."; }
    setBusy(null); if (result) setError(result); else if (message) setSuccess(message); return result;
  };
  const saveNotes = async () => {
    const result = await apply({ action: "saveReview", weekStart: data.weekStart, priorities: reviewDraft.priorities, meals: reviewDraft.meals, logistics: reviewDraft.logistics, revision: savedRevision }, "Your shared week notes are saved.");
    if (!result) setSavedRevision((current) => current + 1);
    return result;
  };
  const nextStep = async () => { if (step === 4 && reviewDirty && await saveNotes()) return; setError(null); setSuccess(null); setStep((current) => Math.min(steps.length - 1, current + 1)); };
  return <Modal title="Plan the week together" onClose={onClose} wide>
    <div className="family-guide">
      <div className="family-guide-heading"><span className="family-kicker">A LITTLE PLANNING, MORE ROOM FOR LIFE</span><h3>{formatWeekRange(data.weekStart)}</h3><p>Build a week that works for everyone.</p></div>
      <nav className="family-steps" aria-label="Weekly planning steps">{steps.map((label, index) => <button key={label} type="button" aria-current={step === index ? "step" : undefined} onClick={() => { if (step === 4 && reviewDirty) { void saveNotes().then((result) => { if (!result) setStep(index); }); } else { setStep(index); setError(null); setSuccess(null); } }}><span>{index + 1}</span>{label}</button>)}</nav>
      <div className="family-step-content">
        {step === 0 && <>
          <div className="family-section-heading"><div><span className="eyebrow">01 · Carry forward</span><h3>What still needs a little attention?</h3><p>Finish, adjust, or bring open tasks into this week.</p></div><span className="family-count">{openItems.length} open</span></div>
          {openItems.length ? <div className="family-item-list">{openItems.map((item) => <div className="family-task" key={item.id}><button className="family-complete" type="button" disabled={!family.canEdit || Boolean(busy)} aria-label={`Complete ${item.text}`} onClick={async () => { setBusy(item.id); await onToggle(item, true); setBusy(null); }}><Circle size={19} /></button><button type="button" className="family-task-copy" onClick={() => onEdit(item)}><strong>{item.text}</strong><small>{item.carryoverCount ? "Carried forward · " : ""}{item.planningDate ? formatMobileDate(item.planningDate) : `Week of ${formatMobileDate(item.weekStartDate)}`}</small></button><ChildBadge child={family.children.find((child) => child.id === item.childId)} />{item.weekStartDate !== data.weekStart && <button className="text-button" disabled={!family.canEdit || Boolean(busy)} onClick={async () => { setBusy(item.id); const result = await onMove(item); setBusy(null); if (result) setError(result); }}>Bring here <ArrowRight size={12} /></button>}</div>)}</div> : <div className="family-empty"><CheckCircle2 size={30} /><h4>A fresh start</h4><p>No unfinished shared tasks to review.</p></div>}
        </>}
        {step === 1 && <>
          <div className="family-section-heading"><div><span className="eyebrow">02 · Look ahead</span><h3>Make room for the busy days.</h3><p>Check the family calendar before adding more to the week.</p></div></div>
          {data.calendarState.status !== "ready" && <p className="family-provider-state" role="status">{data.calendarState.status === "loading" ? "Calendars are still loading. The schedule below may be incomplete." : data.calendarState.status === "not-connected" ? "Connect Google Calendar in Settings to include your family’s commitments." : "Calendar information is unavailable right now. Check your calendar before marking the week reviewed."}</p>}
          {overlaps.length > 0 && <p className="family-provider-state">{overlaps.length} events overlap another event. Check who needs to be there; an overlap may be fine for different family members.</p>}
          <div className="family-agenda">{data.days.map((day) => <section key={day.date}><header><strong>{new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day.date}T12:00:00Z`))}</strong><small>{formatMobileDate(day.date)}</small></header><div>{day.events.length ? day.events.map((event) => <button type="button" key={event.id} onClick={() => onEvent(event)}><i style={{ backgroundColor: event.calendarColor }} /><span>{event.title}</span>{event.isConflict && <small>Overlap</small>}<ChevronRight size={12} /></button>) : <p>{data.calendarState.status === "ready" ? "No calendar events" : "No events loaded"}</p>}</div></section>)}</div>
          <p className="family-muted">Pickup, travel time, or a change of plans? Add it in “Make a plan.”</p>
        </>}
        {step === 2 && <>
          <div className="family-section-heading"><div><span className="eyebrow">03 · Routines</span><h3>Let the familiar things repeat.</h3><p>Shared tasks for school days, home jobs, and everything that comes around again.</p></div></div>
          {routineEditor ? <RoutineEditor key={typeof routineEditor === "string" ? "new" : routineEditor.id} routine={typeof routineEditor === "string" ? undefined : routineEditor} childProfiles={family.children} weekStart={data.weekStart} onCancel={() => setRoutineEditor(null)} onSave={(routine) => apply({ action: "saveRoutine", weekStart: data.weekStart, routine }, "Routine saved. Its tasks appear in the week.")} /> : <>
            <div className="family-card-list">{family.routines.map((routine) => <article className={`family-routine ${!routine.active ? "is-paused" : ""}`} key={routine.id}><Repeat2 size={19} /><div><strong>{routine.text}</strong><p>{routineDescription(routine)}{!routine.active ? " · Stopped" : ""}</p><ChildBadge child={family.children.find((child) => child.id === routine.childId)} /></div>{family.canEdit && <div className="family-row-actions"><button className="text-button" disabled={Boolean(busy)} onClick={() => setRoutineEditor(routine)}>Edit</button><button className="text-button" disabled={Boolean(busy)} onClick={() => void apply({ action: "saveRoutine", weekStart: data.weekStart, routine: { ...routine, active: !routine.active } }, routine.active ? "Future repetitions stopped. Past tasks are kept." : "Routine resumed.")}>{routine.active ? "Stop repeating" : "Resume"}</button></div>}</article>)}</div>
            {family.canEdit && <button className="button button-secondary family-add-button" onClick={() => setRoutineEditor("new")}><Plus size={15} />Add a repeating task</button>}
          </>}
          <section className="family-template-section"><div className="family-section-heading"><div><h4>A head start from a saved week</h4><p>Templates copy one-off shared notes and tasks. Your routines already repeat; calendar events and reminders stay separate.</p></div><Copy size={18} /></div><div className="family-card-list">{family.templates.map((template) => <article className="family-template" key={template.id}><div><strong>{template.name}</strong><small>{template.items.length} notes and tasks</small></div>{family.canEdit && <><button className="button button-secondary" disabled={Boolean(busy) || template.appliedToWeek} onClick={() => setTemplateConfirm(template.id)}>{template.appliedToWeek ? <><Check size={14} />Added this week</> : "Use this week"}</button><button className="icon-button danger" aria-label={`Delete template ${template.name}`} disabled={Boolean(busy)} onClick={() => void apply({ action: "deleteTemplate", weekStart: data.weekStart, id: template.id })}><Trash2 size={15} /></button></>}{templateConfirm === template.id && <div className="family-template-preview"><strong>Add {template.items.length} items to this week?</strong><ul>{template.items.map((item, index) => <li key={index}>{item.dayOffset === null ? "This week" : weekdays[item.dayOffset]} · {item.text}</li>)}</ul><div className="family-form-actions"><button className="text-button" onClick={() => setTemplateConfirm(null)}>Cancel</button><button className="button button-primary" disabled={Boolean(busy)} onClick={async () => { const result = await apply({ action: "applyTemplate", weekStart: data.weekStart, id: template.id }, "Template added to the week."); if (!result) setTemplateConfirm(null); }}>Add to this week</button></div></div>}</article>)}</div>{family.canEdit && <form className="family-template-save" onSubmit={async (event) => { event.preventDefault(); if (!templateName.trim()) return; const result = await apply({ action: "saveTemplate", weekStart: data.weekStart, name: templateName.trim(), id: templateId }, "Week saved as a reusable template."); if (!result) { setTemplateName(""); setTemplateId(crypto.randomUUID()); } }}><label>Save this week as a template<input value={templateName} maxLength={80} placeholder="A regular school week" onChange={(event) => setTemplateName(event.target.value)} required /></label><button className="button button-secondary" disabled={Boolean(busy) || !templateName.trim() || !items.some((item) => item.weekStartDate === data.weekStart && !item.routineId)}>Save template</button></form>}</section>
        </>}
        {step === 3 && <>
          <div className="family-section-heading"><div><span className="eyebrow">04 · Children</span><h3>Their week, part of yours.</h3><p>Add a child’s name and color, then link their calendars and tag their shared tasks. No login needed.</p></div><Users size={23} /></div>
          {childEditor ? <ChildEditor key={typeof childEditor === "string" ? "new" : childEditor.id} child={typeof childEditor === "string" ? undefined : childEditor} calendars={data.visibleCalendars} onSave={(child) => apply({ action: "saveChild", weekStart: data.weekStart, child }, "Child profile saved.")} onCancel={() => setChildEditor(null)} /> : <>
            <div className="family-children-grid">{family.children.map((child) => { const childTasks = items.filter((item) => item.childId === child.id && item.type === "task" && !item.isCompleted); return <article className="family-child-card" key={child.id}><span className="family-child-avatar" style={{ backgroundColor: child.color }}>{child.name.slice(0, 1)}</span><div><h4>{child.name}</h4><p>{child.calendarPreferenceIds.length} linked calendars · {childTasks.length} open tasks</p></div>{family.canEdit && <div className="family-row-actions"><button className="text-button" onClick={() => setChildEditor(child)}>Edit</button><button className="icon-button danger" aria-label={`Remove ${child.name}`} onClick={() => setDeleteChildConfirm(child.id)}><Trash2 size={14} /></button></div>}{deleteChildConfirm === child.id && <div className="family-child-confirm"><p>Remove {child.name}’s profile? Shared tasks and calendars will remain.</p><button className="text-button" onClick={() => setDeleteChildConfirm(null)}>Keep profile</button><button className="button button-danger-quiet" disabled={Boolean(busy)} onClick={async () => { const result = await apply({ action: "deleteChild", weekStart: data.weekStart, id: child.id }, "Child profile removed."); if (!result) setDeleteChildConfirm(null); }}>Remove profile</button></div>}</article>; })}</div>
            {family.canEdit && <button className="button button-secondary family-add-button" onClick={() => setChildEditor("new")}><Plus size={15} />Add a child</button>}
          </>}
          <p className="family-muted">Use the child filter above your weekly calendar to see linked events and tagged tasks together.</p>
        </>}
        {step === 4 && <>
          <div className="family-section-heading"><div><span className="eyebrow">05 · Make a plan</span><h3>Put the important things in one place.</h3><p>These shared notes stay with this week so everyone can refer back to the plan.</p></div></div>
          {family.review.revision !== savedRevision && <div className="family-provider-state"><p>The saved notes have changed since you began editing. Your draft is kept here.</p><button className="button button-secondary" onClick={() => { setReviewDraft(family.review); setSavedRevision(family.review.revision); setError(null); }}>Replace my draft with the latest notes</button></div>}
          <div className="family-review-notes form-stack"><label><span>Our priorities</span><small>What would make this a good week?</small><textarea value={reviewDraft.priorities} disabled={!family.canEdit} maxLength={4000} placeholder="Keep Tuesday evening free. Book the school visit." onChange={(event) => setReviewDraft({ ...reviewDraft, priorities: event.target.value })} /></label><label><span>Meals</span><small>A few dinner ideas are enough.</small><textarea value={reviewDraft.meals} disabled={!family.canEdit} maxLength={4000} placeholder="Monday: pasta. Tuesday: leftovers. Friday: pizza together." onChange={(event) => setReviewDraft({ ...reviewDraft, meals: event.target.value })} /></label><label><span>Logistics & handoffs</span><small>Pickups, travel, things to bring, and who needs to know.</small><textarea value={reviewDraft.logistics} disabled={!family.canEdit} maxLength={4000} placeholder="Early pickup Thursday. Bring the swimming bag on Friday." onChange={(event) => setReviewDraft({ ...reviewDraft, logistics: event.target.value })} /></label></div>
          {family.canEdit && <button className="button button-secondary" disabled={Boolean(busy) || !reviewDirty} onClick={() => void saveNotes()}>{busy === "saveReview" ? "Saving…" : reviewDirty ? "Save shared notes" : "Notes saved"}</button>}
        </>}
        {step === 5 && <>
          <div className="family-section-heading"><div><span className="eyebrow">06 · Review together</span><h3>A shared plan starts with a shared look.</h3><p>Mark this week reviewed when you’ve checked the commitments and shared notes.</p></div></div>
          <div className="family-plan-summary"><div><strong>{openItems.filter((item) => item.weekStartDate === data.weekStart).length}</strong><span>open tasks</span></div><div><strong>{data.calendarState.status === "ready" ? events.length : "—"}</strong><span>calendar events</span></div><div><strong>{family.children.length}</strong><span>children included</span></div></div>
          {data.calendarState.status !== "ready" && <p className="family-provider-state">Calendar information is {data.calendarState.status === "loading" ? "still loading" : "incomplete"}. Review those commitments in your calendar too.</p>}
          <div className="family-reviewers">{eligibleMembers.map((member) => { const confirmation = family.review.reviewedBy.find((review) => review.userId === member.userId); return <div key={member.id}><span className={`family-review-check ${confirmation ? "is-reviewed" : ""}`}>{confirmation ? <Check size={16} /> : <Circle size={16} />}</span><strong>{member.displayName}{member.userId === family.currentUserId ? " (you)" : ""}</strong><small>{confirmation ? "Reviewed this plan" : "Not reviewed yet"}</small></div>; })}</div>
          <p className="family-muted">Each adult reviews for themselves. Changing the shared notes asks everyone to review the updated plan.</p>
          {family.canEdit && <button className={`button ${reviewed ? "button-secondary" : "button-primary"} family-review-button`} disabled={Boolean(busy) || reviewDirty} onClick={() => void apply({ action: "markReviewed", weekStart: data.weekStart, reviewed: !reviewed, revision: family.review.revision }, reviewed ? "Your review was cleared." : "You’ve reviewed this week’s plan.")}>{busy === "markReviewed" ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />}{reviewed ? "Reviewed · mark as not reviewed" : "I’ve reviewed this week"}</button>}
        </>}
        {!family.canEdit && <p className="family-muted">Your household access allows you to view the plan. An adult with editing access can make changes.</p>}
        {error && <p className="family-error" role="alert">{error}</p>}{success && <p className="family-success" role="status"><CheckCircle2 size={15} />{success}</p>}
      </div>
      <footer className="family-guide-footer"><button type="button" className="button button-secondary" disabled={step === 0 || Boolean(busy)} onClick={() => setStep((current) => current - 1)}><ArrowLeft size={14} />Back</button><span>{step + 1} of {steps.length}</span>{step < steps.length - 1 ? <button type="button" className="button button-primary" disabled={Boolean(busy)} onClick={() => void nextStep()}>Continue<ArrowRight size={14} /></button> : <button type="button" className="button button-primary" onClick={onClose}>Back to the week<ArrowRight size={14} /></button>}</footer>
    </div>
  </Modal>;
}

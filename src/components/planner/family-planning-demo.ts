import { addDateDays, todayInTimeZone } from "@/lib/date";
import { routineOccurrencesForWeek } from "@/lib/family-planning";
import type { FamilyPlanningData, FamilyPlanningMutation, PlanningItem, TaskRoutine, WeeklyPlannerData, WeeklyReview } from "@/types/domain";

const storageKey = "week-of-us:family-planning-demo:v1";
interface DemoStore {
  adultCalendars?: Record<string, string[]>;
  children: FamilyPlanningData["children"];
  routines: FamilyPlanningData["routines"];
  templates: FamilyPlanningData["templates"];
  appliedWeeks: Record<string, string[]>;
  reviews: Record<string, WeeklyReview>;
  itemsByWeek: Record<string, PlanningItem[]>;
}
const blankStore = (): DemoStore => ({ children: [], routines: [], templates: [], appliedWeeks: {}, reviews: {}, itemsByWeek: {} });
function readStore(): DemoStore {
  try { const raw = localStorage.getItem(storageKey); return raw ? { ...blankStore(), ...JSON.parse(raw) } : blankStore(); } catch { return blankStore(); }
}
function writeStore(store: DemoStore) { try { localStorage.setItem(storageKey, JSON.stringify(store)); } catch { /* A private browser can still use the current demo session. */ } }
export function emptyFamilyPlanning(weekStart: string, currentUserId: string): FamilyPlanningData {
  return { weekStart, currentUserId, canEdit: true, adults: [], children: [], routines: [], templates: [], openTasks: [], review: { weekStart, priorities: "", meals: "", logistics: "", revision: 0, reviewedBy: [] } };
}
function newTask(data: WeeklyPlannerData, values: Partial<PlanningItem> & Pick<PlanningItem, "id" | "text" | "planningDate">): PlanningItem {
  return { weekStartDate: data.weekStart, type: "task", isCompleted: false, sortOrder: 0, createdBy: data.members[0]?.userId ?? "demo-user", createdByName: data.members[0]?.displayName ?? "You", updatedAt: new Date().toISOString(), saveState: "saved", ...values };
}
function materialize(data: WeeklyPlannerData, store: DemoStore, items: PlanningItem[]): PlanningItem[] {
  const next = [...items];
  for (const routine of store.routines) {
    for (const occurrence of routineOccurrencesForWeek(routine, data.weekStart)) {
      const id = `demo-routine-${routine.id}-${occurrence.occurrenceDate}`;
      if (!next.some((item) => item.id === id || (item.routineId === routine.id && item.routineOccurrenceDate === occurrence.occurrenceDate))) next.push(newTask(data, { id, text: routine.text, planningDate: occurrence.planningDate, childId: routine.childId, routineId: routine.id, routineOccurrenceDate: occurrence.occurrenceDate }));
    }
  }
  return next;
}
function familyFromStore(data: WeeklyPlannerData, currentUserId: string, store: DemoStore): FamilyPlanningData {
  const adults = data.members.map((member) => ({ userId: member.userId, displayName: member.displayName, calendarPreferenceIds: store.adultCalendars?.[member.userId] ?? data.visibleCalendars.filter((calendar) => calendar.sourceUserId === member.userId).map((calendar) => calendar.id) }));
  return { ...emptyFamilyPlanning(data.weekStart, currentUserId), adults, children: store.children, routines: store.routines, templates: store.templates.map((template) => ({ ...template, appliedToWeek: (store.appliedWeeks[template.id] ?? []).includes(data.weekStart) })), review: store.reviews[data.weekStart] ?? emptyFamilyPlanning(data.weekStart, currentUserId).review, openTasks: Object.entries(store.itemsByWeek).filter(([week]) => week < data.weekStart).flatMap(([, items]) => items).filter((item) => item.type === "task" && !item.isCompleted).slice(-100) };
}
export function loadDemoFamilyPlanning(data: WeeklyPlannerData, currentUserId: string): { family: FamilyPlanningData; items: PlanningItem[] } {
  const store = readStore();
  const initialItems = [...data.days.flatMap((day) => day.items), ...data.weeklyItems];
  const items = materialize(data, store, store.itemsByWeek[data.weekStart] ?? initialItems);
  store.itemsByWeek[data.weekStart] = items;
  writeStore(store);
  return { family: familyFromStore(data, currentUserId, store), items };
}
export function persistDemoPlanningItems(weekStart: string, items: PlanningItem[]) {
  const store = readStore();
  store.itemsByWeek[weekStart] = items.filter((item) => item.weekStartDate === weekStart);
  writeStore(store);
}
export function updateDemoPriorItem(item: PlanningItem) {
  const store = readStore();
  for (const week of Object.keys(store.itemsByWeek)) store.itemsByWeek[week] = store.itemsByWeek[week].filter((candidate) => candidate.id !== item.id);
  store.itemsByWeek[item.weekStartDate] = [...(store.itemsByWeek[item.weekStartDate] ?? []), item];
  writeStore(store);
}
export function mutateDemoFamilyPlanning(data: WeeklyPlannerData, currentUserId: string, currentUserName: string, mutation: FamilyPlanningMutation, currentItems: PlanningItem[]): { family: FamilyPlanningData; items: PlanningItem[]; error?: string } {
  const store = readStore();
  let items = [...currentItems];
  store.itemsByWeek[data.weekStart] = items;
  const review = store.reviews[data.weekStart] ?? emptyFamilyPlanning(data.weekStart, currentUserId).review;
  switch (mutation.action) {
    case "saveAdultCalendars":
      store.adultCalendars = { ...store.adultCalendars, [mutation.userId]: mutation.calendarPreferenceIds };
      break;
    case "saveChild": {
      const child = { ...mutation.child, id: mutation.child.id ?? crypto.randomUUID() };
      store.children = [...store.children.filter((candidate) => candidate.id !== child.id), child];
      break;
    }
    case "deleteChild":
      store.children = store.children.filter((child) => child.id !== mutation.id);
      store.routines = store.routines.map((routine) => routine.childId === mutation.id ? { ...routine, childId: null } : routine);
      store.templates = store.templates.map((template) => ({ ...template, items: template.items.map((item) => item.childId === mutation.id ? { ...item, childId: null } : item) }));
      for (const week of Object.keys(store.itemsByWeek)) store.itemsByWeek[week] = store.itemsByWeek[week].map((item) => item.childId === mutation.id ? { ...item, childId: null } : item);
      items = store.itemsByWeek[data.weekStart];
      break;
    case "saveRoutine":
    case "deleteRoutine": {
      const id = mutation.action === "saveRoutine" ? mutation.routine.id ?? crypto.randomUUID() : mutation.id;
      const routine: TaskRoutine | null = mutation.action === "saveRoutine" ? { ...mutation.routine, id, childId: mutation.routine.childId ?? null, endsOn: mutation.routine.endsOn ?? null } : null;
      store.routines = store.routines.filter((candidate) => candidate.id !== id);
      if (routine) store.routines.push(routine);
      const today = todayInTimeZone(data.household.timezone);
      for (const week of Object.keys(store.itemsByWeek)) {
        const valid = routine ? routineOccurrencesForWeek(routine, week) : [];
        store.itemsByWeek[week] = store.itemsByWeek[week].flatMap((item) => {
          if (item.routineId !== id || item.isCompleted || (item.routineOccurrenceDate ?? item.planningDate ?? item.weekStartDate) < today) return [item];
          return valid.some((occurrence) => occurrence.occurrenceDate === item.routineOccurrenceDate) && routine ? [{ ...item, text: routine.text, childId: routine.childId }] : [];
        });
      }
      if (mutation.action === "saveRoutine" && mutation.sourceItemId && routine) {
        const source = store.itemsByWeek[data.weekStart].find((item) => item.id === mutation.sourceItemId);
        const occurrence = routineOccurrencesForWeek(routine, data.weekStart).find((candidate) => candidate.planningDate === source?.planningDate);
        if (!source || !occurrence) return { family: familyFromStore(data, currentUserId, store), items, error: "Choose a repeat day and start date that include this task’s current placement." };
        store.itemsByWeek[data.weekStart] = store.itemsByWeek[data.weekStart].map((item) => item.id === source.id ? { ...item, text: routine.text, childId: routine.childId, routineId: routine.id, routineOccurrenceDate: occurrence.occurrenceDate } : item);
      }
      items = materialize(data, store, store.itemsByWeek[data.weekStart]);
      break;
    }
    case "saveTemplate": {
      const id = mutation.id ?? crypto.randomUUID();
      if (!store.templates.some((template) => template.id === id)) store.templates.push({ id, name: mutation.name, appliedToWeek: false, items: items.filter((item) => item.weekStartDate === data.weekStart && !item.routineId).map((item) => ({ type: item.type, text: item.text, childId: item.childId ?? null, dayOffset: item.planningDate ? Math.round((Date.parse(item.planningDate) - Date.parse(data.weekStart)) / 86_400_000) : null })) });
      break;
    }
    case "deleteTemplate": store.templates = store.templates.filter((template) => template.id !== mutation.id); break;
    case "applyTemplate": {
      const template = store.templates.find((candidate) => candidate.id === mutation.id);
      if (template && !(store.appliedWeeks[template.id] ?? []).includes(data.weekStart)) {
        items.push(...template.items.map((item, index) => newTask(data, { id: `demo-template-${template.id}-${data.weekStart}-${index}`, text: item.text, type: item.type, childId: item.childId, planningDate: item.dayOffset === null ? null : addDateDays(data.weekStart, item.dayOffset) })));
        store.appliedWeeks[template.id] = [...(store.appliedWeeks[template.id] ?? []), data.weekStart];
      }
      break;
    }
    case "assignChild": items = items.map((item) => item.id === mutation.itemId ? { ...item, childId: mutation.childId } : item); break;
    case "saveReview":
      if (review.revision !== mutation.revision) return { family: familyFromStore(data, currentUserId, store), items, error: "The shared notes changed. Reopen the planner to review the latest notes; your draft is still here." };
      store.reviews[data.weekStart] = { ...review, priorities: mutation.priorities, meals: mutation.meals, logistics: mutation.logistics, revision: review.revision + 1, reviewedBy: [] };
      break;
    case "markReviewed":
      if (mutation.revision !== undefined && review.revision !== mutation.revision) return { family: familyFromStore(data, currentUserId, store), items, error: "The plan changed. Review the latest notes before marking the week reviewed." };
      store.reviews[data.weekStart] = { ...review, reviewedBy: [...review.reviewedBy.filter((member) => member.userId !== currentUserId), ...(mutation.reviewed ? [{ userId: currentUserId, displayName: currentUserName, reviewedAt: new Date().toISOString() }] : [])] };
      break;
  }
  store.itemsByWeek[data.weekStart] = items;
  writeStore(store);
  return { family: familyFromStore(data, currentUserId, store), items };
}

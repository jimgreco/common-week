"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, CalendarRange, CloudOff, Menu, Search, Settings, Users, WifiOff, X } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { createCalendarEventAction, deleteCalendarEventAction, updateCalendarEventAction } from "@/app/actions/calendar";
import {
  createPlanningItemAction,
  deletePlanningItemAction,
  hideCalendarEventAction,
  loadPlannerSourcesAction,
  searchPlanningItemsAction,
  setDailyLocationAction,
  setGeocodedLocationAction,
  togglePlanningItemAction,
  updatePlanningItemAction,
} from "@/app/actions/planner";
import { BrandMark } from "@/components/brand-mark";
import { DayColumn, PlanningItemRow } from "@/components/planner/day-column";
import { CalendarEventEditorDialog, EventDetailDialog, ItemEditorDialog, LocationDialog, SearchDialog, WeatherDialog, type LocationSelection } from "@/components/planner/dialogs";
import { addDateDays, currentWeekStart, formatWeekRange, weekDates } from "@/lib/date";
import type { CalendarEvent, CalendarEventDraft, DayPlan, HouseholdLocation, PlanningItem, PlanningItemType, WeeklyPlannerData } from "@/types/domain";

export function WeeklyPlanner({ initialData, currentUserName }: { initialData: WeeklyPlannerData; currentUserName: string }) {
  const router = useRouter();
  const [days, setDays] = useState(initialData.days);
  const [weeklyItems, setWeeklyItems] = useState(initialData.weeklyItems);
  const [locationDate, setLocationDate] = useState<string | null>(null);
  const [weatherDay, setWeatherDay] = useState<DayPlan | null>(null);
  const [editingItem, setEditingItem] = useState<PlanningItem | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [calendarEditor, setCalendarEditor] = useState<{ date: string; event?: CalendarEvent } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PlanningItem[]>([]);
  const [searching, startSearch] = useTransition();
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [calendarState, setCalendarState] = useState(initialData.calendarState);
  const [weatherState, setWeatherState] = useState(initialData.weatherState);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [lastInitialData, setLastInitialData] = useState(initialData);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (lastInitialData !== initialData) {
    setLastInitialData(initialData);
    setDays((current) => mergeUnsavedDays(initialData.days, current, !initialData.isDemo));
    setWeeklyItems((current) => mergeUnsavedItems(initialData.weeklyItems, current));
    setCalendarState(initialData.calendarState);
    setWeatherState(initialData.weatherState);
  }

  useEffect(() => {
    if (initialData.isDemo) return;
    let cancelled = false;
    void loadPlannerSourcesAction(initialData.weekStart).then((result) => {
      if (cancelled) return;
      if (!result.ok || !result.data) {
        setCalendarState({ status: "error", message: "Calendar unavailable." });
        setWeatherState({ status: "error", message: "Weather unavailable." });
        return;
      }
      const sources = new Map(result.data.days.map((day) => [day.date, day]));
      setDays((current) => current.map((day) => {
        const source = sources.get(day.date);
        return source ? { ...day, events: source.events, weather: source.weather } : day;
      }));
      setCalendarState(result.data.calendarState);
      setWeatherState(result.data.weatherState);
    });
    return () => { cancelled = true; };
  }, [initialData]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (initialData.isDemo) return;
    const refresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 250);
    };
    const events = new EventSource("/api/realtime");
    events.addEventListener("change", refresh);
    events.onopen = () => setNotice((current) => current?.startsWith("Live updates") ? null : current);
    events.onerror = () => setNotice("Live updates are reconnecting. Your changes can still be saved.");
    const fallback = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 30_000);
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      window.clearInterval(fallback);
      events.close();
    };
  }, [initialData.household.id, initialData.isDemo, router]);

  const allItems = useMemo(() => [...days.flatMap((day) => day.items), ...weeklyItems], [days, weeklyItems]);
  const thisWeek = currentWeekStart(initialData.household.timezone);
  const previousWeek = addDateDays(initialData.weekStart, -7);
  const nextWeek = addDateDays(initialData.weekStart, 7);

  const placeItem = useCallback((item: PlanningItem, replacingId?: string) => {
    setDays((current) => current.map((day) => ({
      ...day,
      items: day.items.filter((candidate) => candidate.id !== (replacingId ?? item.id) && candidate.id !== item.id),
    })).map((day) => day.date === item.planningDate ? { ...day, items: [...day.items, item] } : day));
    setWeeklyItems((current) => {
      const without = current.filter((candidate) => candidate.id !== (replacingId ?? item.id) && candidate.id !== item.id);
      return item.planningDate === null ? [...without, item] : without;
    });
  }, []);

  const addItem = useCallback(async (date: string | null, text: string, type: PlanningItemType, categoryId: string | null) => {
    const category = initialData.categories.find((candidate) => candidate.id === categoryId);
    const temporaryId = `draft-${crypto.randomUUID()}`;
    const optimistic: PlanningItem = {
      id: temporaryId,
      planningDate: date,
      weekStartDate: initialData.weekStart,
      type,
      categoryId,
      categoryName: category?.name ?? null,
      categoryColor: category?.color ?? null,
      text,
      isCompleted: false,
      sortOrder: 0,
      createdBy: "current-user",
      createdByName: currentUserName,
      updatedAt: new Date().toISOString(),
      saveState: initialData.isDemo ? "saved" : "saving",
    };
    placeItem(optimistic);
    if (initialData.isDemo) return;
    const result = await createPlanningItemAction({ text, type, planningDate: date, weekStartDate: initialData.weekStart, categoryId });
    if (result.ok && result.data) {
      placeItem({ ...result.data, categoryName: category?.name ?? null, categoryColor: category?.color ?? null, createdByName: currentUserName }, temporaryId);
    } else {
      placeItem({ ...optimistic, saveState: "failed" });
      setNotice(result.error ?? "Save failed. Your text is still here.");
    }
  }, [currentUserName, initialData.categories, initialData.isDemo, initialData.weekStart, placeItem]);

  const retryItem = useCallback(async (item: PlanningItem) => {
    if (!item.id.startsWith("draft-")) {
      setEditingItem(item);
      return;
    }
    placeItem({ ...item, saveState: "saving" });
    const result = await createPlanningItemAction({
      text: item.text,
      type: item.type,
      planningDate: item.planningDate,
      weekStartDate: item.weekStartDate,
      categoryId: item.categoryId,
    });
    if (result.ok && result.data) placeItem({ ...result.data, categoryName: item.categoryName, categoryColor: item.categoryColor }, item.id);
    else placeItem({ ...item, saveState: "failed" });
  }, [placeItem]);

  const toggleItem = useCallback(async (item: PlanningItem, completed: boolean) => {
    placeItem({ ...item, isCompleted: completed });
    if (initialData.isDemo || item.id.startsWith("draft-")) return;
    const result = await togglePlanningItemAction(item.id, completed);
    if (!result.ok) {
      placeItem(item);
      setNotice(result.error ?? "Task status could not be saved.");
    }
  }, [initialData.isDemo, placeItem]);

  const saveEditedItem = useCallback(async (item: PlanningItem) => {
    const original = allItems.find((candidate) => candidate.id === item.id);
    const category = initialData.categories.find((candidate) => candidate.id === item.categoryId);
    const optimistic = { ...item, categoryName: category?.name ?? null, categoryColor: category?.color ?? null, saveState: initialData.isDemo ? "saved" as const : "saving" as const };
    placeItem(optimistic);
    setEditingItem(null);
    if (initialData.isDemo || item.id.startsWith("draft-")) return;
    const result = await updatePlanningItemAction({
      id: item.id,
      text: item.text,
      type: item.type,
      planningDate: item.planningDate,
      weekStartDate: item.weekStartDate,
      categoryId: item.categoryId,
    });
    if (!result.ok) {
      placeItem({ ...optimistic, saveState: "failed" });
      setNotice(result.error ?? "Changes could not be saved.");
    } else {
      placeItem({ ...optimistic, saveState: "saved" });
    }
    if (!original) router.refresh();
  }, [allItems, initialData.categories, initialData.isDemo, placeItem, router]);

  const deleteItem = useCallback(async (item: PlanningItem) => {
    setDays((current) => current.map((day) => ({ ...day, items: day.items.filter((candidate) => candidate.id !== item.id) })));
    setWeeklyItems((current) => current.filter((candidate) => candidate.id !== item.id));
    setEditingItem(null);
    if (initialData.isDemo || item.id.startsWith("draft-")) return;
    const result = await deletePlanningItemAction(item.id);
    if (!result.ok) {
      placeItem(item);
      setNotice(result.error ?? "The item could not be deleted.");
    }
  }, [initialData.isDemo, placeItem]);

  const hideEvent = useCallback(async (event: CalendarEvent): Promise<string | null> => {
    if (!initialData.isDemo) {
      const result = await hideCalendarEventAction({
        eventId: event.id,
        title: event.title,
        calendarName: event.calendarAlias,
        eventStart: event.start,
      });
      if (!result.ok) return result.error ?? "The event could not be hidden.";
    }
    setDays((current) => current.map((day) => ({
      ...day,
      events: day.events.filter((candidate) => candidate.id !== event.id),
    })));
    setSelectedEvent(null);
    setNotice(`“${event.title}” is hidden from Common Week. Restore it in Settings.`);
    return null;
  }, [initialData.isDemo]);

  const refreshPlannerSources = useCallback(async () => {
    if (initialData.isDemo) return;
    const result = await loadPlannerSourcesAction(initialData.weekStart);
    if (!result.ok || !result.data) {
      setNotice(result.error ?? "Google Calendar could not be refreshed.");
      return;
    }
    const sources = new Map(result.data.days.map((day) => [day.date, day]));
    setDays((current) => current.map((day) => {
      const source = sources.get(day.date);
      return source ? { ...day, events: source.events, weather: source.weather } : day;
    }));
    setCalendarState(result.data.calendarState);
  }, [initialData.isDemo, initialData.weekStart]);

  const saveCalendarEvent = useCallback(async (draft: CalendarEventDraft): Promise<string | null> => {
    if (initialData.isDemo) {
      setNotice(`Demo event ${draft.providerEventId ? "updated" : "added"}.`);
      return null;
    }
    const result = draft.providerEventId
      ? await updateCalendarEventAction(draft)
      : await createCalendarEventAction(draft);
    if (!result.ok) return result.error ?? "Google Calendar could not save this event.";
    await refreshPlannerSources();
    setNotice(draft.providerEventId ? "Google Calendar event updated." : "Google Calendar event added.");
    return null;
  }, [initialData.isDemo, refreshPlannerSources]);

  const deleteCalendarEvent = useCallback(async (event: CalendarEvent): Promise<string | null> => {
    if (!event.calendarPreferenceId || !event.providerEventId || !event.etag) return "Refresh the week before deleting this event.";
    if (!initialData.isDemo) {
      const result = await deleteCalendarEventAction({ calendarPreferenceId: event.calendarPreferenceId, providerEventId: event.providerEventId, etag: event.etag });
      if (!result.ok) return result.error ?? "Google Calendar could not delete this event.";
      await refreshPlannerSources();
    } else {
      setDays((current) => current.map((day) => ({ ...day, events: day.events.filter((candidate) => candidate.id !== event.id) })));
    }
    setSelectedEvent(null);
    setNotice("Google Calendar event deleted.");
    return null;
  }, [initialData.isDemo, refreshPlannerSources]);

  const setLocation = useCallback(async (selection: LocationSelection, scope: "day" | "through-sunday" | "week"): Promise<string | null> => {
    if (!locationDate) return "Choose a day before setting its location.";
    let location: HouseholdLocation;
    if (selection.kind === "saved") {
      location = selection.location;
      if (!initialData.isDemo) {
        const result = await setDailyLocationAction({ startDate: locationDate, locationId: location.id, scope });
        if (!result.ok) return result.error ?? "Location changes could not be saved.";
      }
    } else if (initialData.isDemo) {
      location = {
        id: selection.result.id,
        name: selection.name,
        latitude: selection.result.latitude,
        longitude: selection.result.longitude,
        timezone: selection.result.timezone,
        isSaved: true,
      };
    } else {
      const result = await setGeocodedLocationAction({
        startDate: locationDate,
        scope,
        location: {
          name: selection.name,
          latitude: selection.result.latitude,
          longitude: selection.result.longitude,
          timezone: selection.result.timezone,
        },
      });
      if (!result.ok || !result.data) return result.error ?? "The location could not be saved.";
      location = result.data;
    }

    const monday = initialData.weekStart;
    const start = scope === "week" ? monday : locationDate;
    const end = scope === "day" ? start : addDateDays(monday, 6);
    setDays((current) => current.map((day) => day.date >= start && day.date <= end
      ? { ...day, location, weather: initialData.isDemo && day.weather ? { ...day.weather, locationId: location.id } : null }
      : day));
    setLocationDate(null);
    if (!initialData.isDemo) router.refresh();
    return null;
  }, [initialData.isDemo, initialData.weekStart, locationDate, router]);

  const runSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (query.trim().length < 2) { setSearchResults([]); return; }
    if (initialData.isDemo) {
      const lowered = query.toLowerCase();
      setSearchResults(allItems.filter((item) => item.text.toLowerCase().includes(lowered)));
      return;
    }
    startSearch(async () => {
      const result = await searchPlanningItemsAction(query);
      setSearchResults(result.data ?? []);
    });
  }, [allItems, initialData.isDemo]);

  return (
    <main className="app-frame">
      <header className="app-topbar">
        <BrandMark compact />
        <div className="topbar-household"><Users size={14} /><span>{initialData.household.name}</span></div>
        <nav className={`topbar-actions ${mobileMenu ? "is-open" : ""}`} aria-label="Account navigation">
          <button className="topbar-link" type="button" onClick={() => { setSearchOpen(true); setMobileMenu(false); }}><Search size={15} /> Search</button>
          <Link className="topbar-link" href="/settings"><Settings size={15} /> Settings</Link>
          {!initialData.isDemo && <form action={signOut}><button className="topbar-link" type="submit">Sign out</button></form>}
          <span className="avatar" title={currentUserName}>{initials(currentUserName)}</span>
        </nav>
        <button className="mobile-menu-button" type="button" aria-label="Toggle menu" onClick={() => setMobileMenu((value) => !value)}>{mobileMenu ? <X size={19} /> : <Menu size={19} />}</button>
      </header>

      {!online && <div className="status-banner warning" role="alert"><WifiOff size={14} /> You’re offline. Unsaved text will stay on screen so you can retry.</div>}
      {notice && <div className="status-banner" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss"><X size={14} /></button></div>}
      {initialData.isDemo && <div className="demo-banner">Interactive demo · Add, edit, complete, move, and plan freely. <Link href="/settings">View setup</Link></div>}

      <section className="planner-shell">
        <header className="week-header">
          <div>
            <p className="eyebrow">Weekly plan</p>
            <h1>{formatWeekRange(initialData.weekStart)}</h1>
          </div>
          <nav className="week-navigation" aria-label="Week navigation">
            <Link href={`/planner?week=${previousWeek}`} aria-label="Previous week"><ArrowLeft size={16} /><span>Previous</span></Link>
            <Link className={initialData.weekStart === thisWeek ? "is-current" : ""} href={`/planner?week=${thisWeek}`}>This week</Link>
            <Link href={`/planner?week=${nextWeek}`} aria-label="Next week"><span>Next</span><ArrowRight size={16} /></Link>
          </nav>
          <Link className="plan-next-link" href={`/planner?week=${nextWeek}`}><CalendarRange size={15} /> Plan next week <ArrowRight size={14} /></Link>
        </header>

        {calendarState.status === "error" && <div className="source-alert" role="status"><CalendarRange size={14} />{calendarState.message}</div>}
        {calendarState.status === "not-connected" && <div className="source-alert"><CalendarRange size={14} />{calendarState.message}<Link href="/settings">Connect</Link></div>}
        {weatherState.status === "error" && <div className="source-alert" role="status"><CloudOff size={14} />{weatherState.message}</div>}

        <div className="week-grid">
          {days.map((day) => (
            <DayColumn
              day={day}
              categories={initialData.categories}
              timeZone={initialData.household.timezone}
              temperatureUnit={initialData.household.temperatureUnit}
              calendarState={calendarState}
              weatherState={weatherState}
              onAdd={addItem}
              onToggle={toggleItem}
              onEdit={setEditingItem}
              onRetry={retryItem}
              onLocation={setLocationDate}
              onWeather={setWeatherDay}
              onEvent={setSelectedEvent}
              onAddEvent={(date) => setCalendarEditor({ date })}
              canAddEvent={initialData.editableCalendars.length > 0}
              key={day.date}
            />
          ))}
        </div>

        <section className="weekly-section" aria-label="Weekly notes and tasks">
          <header><span>This week</span><small>Notes and tasks that don’t belong to one day</small></header>
          <div className="weekly-columns">
            <div><h2>Plans & notes</h2>{weeklyItems.filter((item) => item.type === "note").map((item) => <PlanningItemRow item={item} onToggle={toggleItem} onEdit={setEditingItem} onRetry={retryItem} key={item.id} />)}<WeeklyQuickAdd type="note" categories={initialData.categories} onAdd={addItem} /></div>
            <div><h2>Tasks</h2>{weeklyItems.filter((item) => item.type === "task").map((item) => <PlanningItemRow item={item} onToggle={toggleItem} onEdit={setEditingItem} onRetry={retryItem} key={item.id} />)}<WeeklyQuickAdd type="task" categories={initialData.categories} onAdd={addItem} /></div>
          </div>
        </section>
      </section>

      {locationDate && <LocationDialog date={locationDate} locations={initialData.locations} currentLocationId={days.find((day) => day.date === locationDate)?.location?.id ?? null} isDemo={initialData.isDemo} onClose={() => setLocationDate(null)} onSave={setLocation} />}
      {weatherDay && <WeatherDialog day={weatherDay} timeZone={initialData.household.timezone} temperatureUnit={initialData.household.temperatureUnit} onClose={() => setWeatherDay(null)} />}
      {selectedEvent && <EventDetailDialog event={selectedEvent} timeZone={initialData.household.timezone} onClose={() => setSelectedEvent(null)} onHide={hideEvent} onEdit={(event) => { setSelectedEvent(null); setCalendarEditor({ date: event.start.slice(0, 10), event }); }} />}
      {calendarEditor && <CalendarEventEditorDialog date={calendarEditor.date} event={calendarEditor.event} calendars={initialData.editableCalendars} timeZone={initialData.household.timezone} onClose={() => setCalendarEditor(null)} onSave={saveCalendarEvent} onDelete={deleteCalendarEvent} />}
      {editingItem && <ItemEditorDialog item={editingItem} weekDates={weekDates(initialData.weekStart)} categories={initialData.categories} onClose={() => setEditingItem(null)} onSave={saveEditedItem} onDelete={deleteItem} />}
      {searchOpen && <SearchDialog results={searchResults} query={searchQuery} loading={searching} onQuery={runSearch} onClose={() => { setSearchOpen(false); setSearchQuery(""); setSearchResults([]); }} />}
    </main>
  );
}

function WeeklyQuickAdd({ type, categories, onAdd }: { type: PlanningItemType; categories: WeeklyPlannerData["categories"]; onAdd: (date: string | null, text: string, type: PlanningItemType, categoryId: string | null) => void }) {
  return (
    <form className="weekly-quick-add" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const text = String(data.get("text") ?? "").trim(); if (!text) return; onAdd(null, text, type, String(data.get("category") || "") || null); form.reset(); }}>
      <input name="text" aria-label={`Add weekly ${type}`} placeholder={`Add weekly ${type}…`} maxLength={1000} />
      <select name="category" aria-label="Category"><option value="">No category</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select>
      <button type="submit">Add</button>
    </form>
  );
}

function mergeUnsavedItems(serverItems: PlanningItem[], currentItems: PlanningItem[]): PlanningItem[] {
  const unsaved = currentItems.filter((item) => item.saveState === "failed" || item.saveState === "saving");
  const unsavedIds = new Set(unsaved.map((item) => item.id));
  return [...serverItems.filter((item) => !unsavedIds.has(item.id)), ...unsaved];
}

function mergeUnsavedDays(serverDays: DayPlan[], currentDays: DayPlan[], preserveSources = false): DayPlan[] {
  const currentByDate = new Map(currentDays.map((day) => [day.date, day]));
  return serverDays.map((day) => ({
    ...day,
    events: preserveSources ? currentByDate.get(day.date)?.events ?? day.events : day.events,
    weather: preserveSources ? currentByDate.get(day.date)?.weather ?? day.weather : day.weather,
    items: mergeUnsavedItems(day.items, currentByDate.get(day.date)?.items ?? []),
  }));
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "ME";
}

"use client";
import { useEffect, useState } from "react";
import { Modal } from "./dialogs";
import {
  childrenForEvent,
  coverageStatus,
  coverageWarnings,
  defaultCoverage,
  type EventCoverage,
} from "@/lib/coverage";
import type { WeeklyPlannerData } from "@/types/domain";
export function CoveragePanel({
  data,
  userId,
  onClose,
}: {
  data: WeeklyPlannerData;
  userId: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<EventCoverage[]>([]),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false);
  const events = [
    ...new Map(
      data.days.flatMap((d) => d.events).map((e) => [e.id, e]),
    ).values(),
  ];
  const canEdit =
    data.isDemo ||
    data.members.some((m) => m.userId === userId && m.role !== "viewer");
  useEffect(() => {
    let active = true;
    if (data.isDemo) {
      queueMicrotask(() => {
        if (!active) return;
        try {
          setRows(JSON.parse(localStorage.getItem("demo-coverage") ?? "[]"));
        } catch {}
        setLoaded(true);
      });
      return () => {
        active = false;
      };
    }
    fetch("/api/coverage")
      .then((r) => r.json())
      .then((r) => {
        if (active) {
          if (!r.ok) throw Error(r.error);
          setRows(r.data);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [data.isDemo]);
  async function save(
    entry: EventCoverage,
    confirmation?: "dropOff" | "pickup",
    confirmed?: boolean,
  ) {
    setError("");
    if (data.isDemo) {
      const next = { ...entry, revision: entry.revision + 1 };
      if (confirmation === "dropOff") next.dropOffConfirmed = confirmed ?? true;
      if (confirmation === "pickup") next.pickupConfirmed = confirmed ?? true;
      const updated = [
        ...rows.filter(
          (r) =>
            !(
              r.calendarId === entry.calendarId &&
              r.eventId === entry.eventId &&
              r.childId === entry.childId
            ),
        ),
        next,
      ];
      setRows(updated);
      localStorage.setItem("demo-coverage", JSON.stringify(updated));
      return;
    }
    const r = await fetch("/api/coverage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...entry, confirmation, confirmed }),
    }).then((r) => r.json());
    if (!r.ok) throw Error(r.error);
    setRows(r.data);
  }
  const relevant = events.filter(
    (e) =>
      e.calendarPreferenceId &&
      e.providerEventId &&
      childrenForEvent(e, data.childProfiles ?? []).length,
  );
  return (
    <Modal title="Pickup & drop-off" onClose={onClose} wide>
      <div className="week-tools-body">
      <p>
        Plan each child’s handoffs. The assigned adult confirms their own
        coverage.
      </p>
      {error && <p role="alert">{error}</p>}
      {!loaded && !error && <p>Loading coverage…</p>}
      {coverageWarnings(events, rows).map((w) => (
        <p className="status-banner warning" key={w}>
          {w}
        </p>
      ))}
      {loaded && !relevant.length && (
        <p>
          No child events this week. Assign children to calendars or events to
          plan their transport.
        </p>
      )}
      {loaded &&
        relevant.map((e) => (
          <section className="coverage-event" key={e.id}>
            <h3>{e.title}</h3>
            <p>
              {new Intl.DateTimeFormat(undefined, {
                timeZone: data.household.timezone,
                dateStyle: "medium",
                ...(!e.allDay ? { timeStyle: "short" as const } : {}),
              }).format(new Date(e.start))}
              {e.allDay
                ? " · All day — confirm handoff times in notes"
                : ` – ${new Intl.DateTimeFormat(undefined,{timeZone:data.household.timezone,timeStyle:"short"}).format(new Date(e.end))}`}
            </p>
            {childrenForEvent(e, data.childProfiles ?? []).map((c) => {
              const row =
                rows.find(
                  (r) =>
                    r.calendarId === e.calendarPreferenceId &&
                    r.eventId === e.providerEventId &&
                    r.childId === c.id,
                ) ??
                defaultCoverage(
                  e.calendarPreferenceId!,
                  e.providerEventId!,
                  c.id,
                );
              return (
                <CoverageEditor
                  key={`${c.id}:${row.revision}`}
                  entry={row}
                  name={c.name}
                  data={data}
                  userId={userId}
                  canEdit={canEdit}
                  save={save}
                />
              );
            })}
          </section>
        ))}
      <p className="muted">
        Travel warnings compare scheduled handoffs and assigned events using
        your buffer. They do not use live traffic. All-day events are excluded
        from travel checks.
      </p>
      </div>
    </Modal>
  );
}
function CoverageEditor({
  entry,
  name,
  data,
  userId,
  canEdit,
  save,
}: {
  entry: EventCoverage;
  name: string;
  data: WeeklyPlannerData;
  userId: string;
  canEdit: boolean;
  save: (
    e: EventCoverage,
    c?: "dropOff" | "pickup",
    confirmed?: boolean,
  ) => Promise<void>;
}) {
  const [draft, setDraft] = useState(entry),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(c?: "dropOff" | "pickup", confirmed?: boolean) {
    setBusy(true);
    setError("");
    try {
      await save(draft, c, confirmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save coverage.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset className="coverage-child" disabled={!canEdit || busy}>
      <legend>{name}</legend>
      <p>{coverageStatus(draft)}</p>
      {(["dropOff", "pickup"] as const).map((leg) => {
        const owner = leg === "dropOff" ? "dropOffUserId" : "pickupUserId",
          needed = leg === "dropOff" ? "dropOffNeeded" : "pickupNeeded",
          confirmed =
            leg === "dropOff" ? "dropOffConfirmed" : "pickupConfirmed";
        return (
          <div className="coverage-leg" key={leg}>
            <label>
              <input
                type="checkbox"
                checked={draft[needed]}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    [needed]: e.target.checked,
                    [confirmed]: false,
                  })
                }
              />
              {leg === "dropOff" ? "Drop-off" : "Pickup"} needed
            </label>
            {draft[needed] && (
              <>
                <select
                  aria-label={`${name} ${leg} adult`}
                  value={draft[owner] ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      [owner]: e.target.value || null,
                      [confirmed]: false,
                    })
                  }
                >
                  <option value="">Needs an owner</option>
                  {data.members
                    .filter((m) => m.role !== "viewer")
                    .map((m) => (
                      <option value={m.userId} key={m.userId}>
                        {m.displayName}
                      </option>
                    ))}
                </select>
                {draft[owner] === userId && (
                  <button
                    className="text-button"
                    onClick={() => void submit(leg, !draft[confirmed])}
                  >
                    {draft[confirmed]
                      ? "Withdraw confirmation"
                      : "I can do this"}
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}
      <label>
        Travel buffer (minutes)
        <input
          type="number"
          min="0"
          max="180"
          value={draft.travelMinutes}
          onChange={(e) =>
            setDraft({ ...draft, travelMinutes: Number(e.target.value) })
          }
        />
      </label>
      <label>
        Handoff notes
        <textarea
          maxLength={1000}
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="button button-primary" onClick={() => void submit()}>
        {busy ? "Saving…" : "Save coverage"}
      </button>
    </fieldset>
  );
}

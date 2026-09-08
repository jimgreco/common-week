"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./dialogs";
import { defaultWeekShare, weekHTML } from "@/lib/week-share";
import type { WeeklyPlannerData } from "@/types/domain";
export function WeekShare({
  data,
  onClose,
}: {
  data: WeeklyPlannerData;
  onClose: () => void;
}) {
  const [options, setOptions] = useState(defaultWeekShare),
    [display, setDisplay] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!display) return;
    const timer = setInterval(() => router.refresh(), 60000);
    let lock: WakeLockSentinel | undefined;
    let disposed = false;
    void navigator.wakeLock
      ?.request("screen")
      .then((l) => {
        if (disposed) void l.release(); else lock = l;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      clearInterval(timer);
      void lock?.release();
    };
  }, [display, router]);
  const people = [
    ...data.members.map((m) => ({ id: m.userId, name: m.displayName })),
    ...(data.childProfiles ?? []).map((c) => ({ id: c.id, name: c.name })),
  ];
  const preview = (
    <iframe
      ref={frame}
      title="Shareable week preview"
      className="week-share-preview"
      srcDoc={weekHTML(data, options)}
    />
  );
  if (display)
    return (
      <div className="kitchen-display">
        <header>
          <strong>Kitchen display · Week of {data.weekStart}</strong>
          <span>Refreshes every minute</span>
          <button className="button" onClick={() => setDisplay(false)}>
            Exit display
          </button>
        </header>
        {preview}
      </div>
    );
  return (
    <Modal title="Share your week" onClose={onClose} wide>
      <div className="week-tools-body">
      <p>
        Choose what goes on the fridge or kitchen display. Notes and private
        calendars are excluded by default.
      </p>
      <fieldset>
        <legend>People</legend>
        <label>
          <input
            type="checkbox"
            checked={!options.memberIds.length}
            onChange={() => setOptions({ ...options, memberIds: [] })}
          />
          Everyone, including unassigned plans
        </label>
        {people.map((p) => (
          <label key={p.id}>
            <input
              type="checkbox"
              checked={options.memberIds.includes(p.id)}
              onChange={(e) =>
                setOptions({
                  ...options,
                  memberIds: e.target.checked
                    ? [...options.memberIds, p.id]
                    : options.memberIds.filter((id) => id !== p.id),
                })
              }
            />
            {p.name}
          </label>
        ))}
      </fieldset>
      <div className="share-options">
        {(
          [
            ["events", "Events"],
            ["tasks", "Tasks"],
            ["notes", "Notes"],
            ["privateCalendars", "My private calendars"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={options[key]}
              onChange={(e) =>
                setOptions({ ...options, [key]: e.target.checked })
              }
            />
            {label}
          </label>
        ))}
      </div>
      <div className="dialog-actions">
        <button
          className="button button-primary"
          onClick={() => frame.current?.contentWindow?.print()}
        >
          Print / Save PDF
        </button>
        <button className="button" onClick={() => setDisplay(true)}>
          Kitchen display
        </button>
      </div>
      {preview}
      </div>
    </Modal>
  );
}

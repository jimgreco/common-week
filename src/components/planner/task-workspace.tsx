"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { Modal } from "@/components/planner/dialogs";
import {
  taskMatchesFilter,
  type TaskRecord,
  type ItemResource,
  type TaskWorkspaceData,
  type WorkspaceMutation,
  type CollaborationEntry,
} from "@/lib/task-workspace";
import { weekStartForDate } from "@/lib/date";

type Person = { id: string; name: string };
type WorkspaceContextValue = {
  people: Person[];
  userId: string;
  canEdit: boolean;
  week: string;
  today: string;
  load: (resource?: ItemResource) => Promise<TaskWorkspaceData>;
  mutate: (mutation: WorkspaceMutation) => Promise<void>;
  download: (entry: CollaborationEntry) => Promise<void>;
};
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
export function TaskWorkspaceProvider({
  children,
  people,
  userId,
  canEdit,
  week,
  today,
  isDemo,
  tasks,
  onChange,
}: {
  children: ReactNode;
  people: Person[];
  userId: string;
  canEdit: boolean;
  week: string;
  today: string;
  isDemo: boolean;
  tasks: TaskRecord[];
  onChange: (task?: TaskRecord) => void;
}) {
  const taskRef = useRef(tasks);
  useEffect(() => {
    taskRef.current = tasks;
  }, [tasks]);
  const changed = useRef(onChange);
  useEffect(() => {
    changed.current = onChange;
  }, [onChange]);
  const demoRead = useCallback(() => {
    const saved = JSON.parse(
      localStorage.getItem("weekofus-task-workspace") ?? "{}",
    ) as {
      tasks?: TaskRecord[];
      entries?: Record<string, CollaborationEntry[]>;
      files?: Record<string, string>;
    };
    return {
      tasks: [
        ...taskRef.current.filter(
          (t) => !saved.tasks?.some((s) => s.id === t.id),
        ),
        ...(saved.tasks ?? []),
      ],
      entries: saved.entries ?? {},
      files: saved.files ?? {},
    };
  }, []);
  const load = useCallback(
    async (resource?: ItemResource): Promise<TaskWorkspaceData> => {
      if (isDemo) {
        const d = demoRead();
        return {
          tasks: resource ? [] : d.tasks.filter((t) => t.type === "task"),
          task:
            resource && "itemId" in resource
              ? (d.tasks.find((t) => t.id === resource.itemId) ?? null)
              : null,
          entries: resource ? (d.entries[JSON.stringify(resource)] ?? []) : [],
        };
      }
      const result = await fetch(
        `/api/task-workspace?${new URLSearchParams(resource ?? {})}`,
        { cache: "no-store" },
      ).then((r) => r.json());
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
    [isDemo, demoRead],
  );
  const mutate = useCallback(
    async (input: WorkspaceMutation) => {
      if (!isDemo) {
        const result = await fetch("/api/task-workspace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }).then((r) => r.json());
        if (!result.ok) throw new Error(result.error);
        changed.current();
        return;
      }
      const d = demoRead();
      let updated: TaskRecord | undefined;
      if (input.action === "capture") {
        updated = {
          id: input.id,
          text: input.text,
          type: "task",
          isBacklog: true,
          deadline: null,
          planningDate: null,
          weekStartDate: week,
          isCompleted: false,
          responsibleMemberId: null,
        };
        d.tasks.push(updated);
      } else if (input.action === "task") {
        const t = d.tasks.find((t) => t.id === input.resource.itemId);
        if (!t) throw new Error("Task not found.");
        Object.assign(t, input);
        if (input.claim) t.responsibleMemberId = userId;
        if (t.isBacklog) t.planningDate = null;
        else if (t.planningDate)
          t.weekStartDate = weekStartForDate(t.planningDate);
        updated = t;
      } else {
        const key = JSON.stringify(input.resource);
        const entries = (d.entries[key] ??= []);
        if (input.action === "add") {
          entries.push({
            id: input.id,
            kind: input.kind,
            text: input.text,
            completed: false,
            createdBy: userId,
            author: people.find((p) => p.id === userId)?.name ?? "You",
            createdAt: new Date().toISOString(),
          });
          if (input.fileData) d.files[input.id] = input.fileData;
        } else if (input.action === "check") {
          const e = entries.find((e) => e.id === input.id);
          if (e) e.completed = input.completed;
        } else {
          d.entries[key] = entries.filter((e) => e.id !== input.id);
          delete d.files[input.id];
        }
      }
      localStorage.setItem("weekofus-task-workspace", JSON.stringify(d));
      changed.current(updated);
    },
    [isDemo, demoRead, week, userId, people],
  );
  const download = async (entry: CollaborationEntry) => {
    let blob: Blob;
    if (isDemo) {
      const raw = atob(demoRead().files[entry.id] ?? "");
      blob = new Blob([Uint8Array.from(raw, (c) => c.charCodeAt(0))]);
    } else {
      const response = await fetch(`/api/task-workspace?file=${entry.id}`);
      if (!response.ok) throw new Error("File could not be downloaded.");
      blob = await response.blob();
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = entry.text;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <WorkspaceContext.Provider
      value={{ people, userId, canEdit, week, today, load, mutate, download }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function TaskWorkspaceDialog({
  onClose,
  initialItemId,
}: {
  onClose: () => void;
  initialItemId?: string;
}) {
  const context = useContext(WorkspaceContext)!;
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [filter, setFilter] = useState("All");
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string | null>(
    initialItemId ?? null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const loadTasks = context.load;
  const refresh = useCallback(async () => {
    try {
      setTasks((await loadTasks()).tasks);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [loadTasks]);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);
  async function capture() {
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      await context.mutate({
        action: "capture",
        id: crypto.randomUUID(),
        text: text.trim(),
      });
      setText("");
      setFilter("Backlog");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (selected)
    return (
      <Modal
        title={tasks.find((t) => t.id === selected)?.text ?? "Task details"}
        onClose={() => {
          setSelected(null);
          void refresh();
        }}
      >
        <div className="modal-body">
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              void refresh();
            }}
          >
            ← All tasks
          </button>
          <ItemCollaboration resource={{ itemId: selected }} />
        </div>
      </Modal>
    );
  return (
    <Modal title="Household tasks" onClose={onClose} wide>
      <div className="modal-body task-workspace">
        <p className="muted">
          Share responsibilities, keep deadlines in view, and choose what
          belongs in your week.
        </p>
        {context.canEdit && (
          <div className="workspace-capture">
            <input
              aria-label="Capture a task"
              placeholder="Something to do, whenever you’re ready…"
              value={text}
              maxLength={1000}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void capture();
              }}
            />
            <button
              type="button"
              className="primary-button"
              disabled={busy || !text.trim()}
              onClick={() => void capture()}
            >
              Add to backlog
            </button>
          </div>
        )}
        <div
          className="workspace-filters"
          role="group"
          aria-label="Task filters"
        >
          {["All", "Mine", "Unassigned", "Backlog", "Overdue", "Completed"].map(
            (f) => (
              <button
                type="button"
                key={f}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ),
          )}
        </div>
        {error && <p role="alert">{error}</p>}
        <div className="workspace-task-list">
          {tasks
            .filter((t) =>
              taskMatchesFilter(t, filter, context.userId, context.today),
            )
            .map((t) => (
              <button
                type="button"
                className="workspace-task"
                key={t.id}
                onClick={() => setSelected(t.id)}
              >
                <strong>{t.text}</strong>
                <span>
                  {context.people.find((p) => p.id === t.responsibleMemberId)
                    ?.name ?? "Unassigned"}{" "}
                  ·{" "}
                  {t.isBacklog
                    ? "Backlog"
                    : (t.planningDate ?? `Week of ${t.weekStartDate}`)}
                </span>
                {t.deadline && (
                  <span
                    className={
                      !t.isCompleted && t.deadline < context.today
                        ? "workspace-overdue"
                        : ""
                    }
                  >
                    Due {t.deadline}
                  </span>
                )}
              </button>
            ))}
        </div>
        {!tasks.some((t) =>
          taskMatchesFilter(t, filter, context.userId, context.today),
        ) && (
          <p className="muted">
            No {filter.toLowerCase() === "all" ? "open" : filter.toLowerCase()}{" "}
            tasks.
          </p>
        )}
      </div>
    </Modal>
  );
}
export function ItemCollaboration({
  resource,
  includePlacement = true,
}: {
  resource: ItemResource;
  includePlacement?: boolean;
}) {
  const context = useContext(WorkspaceContext);
  const [data, setData] = useState<TaskWorkspaceData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState("");
  const [comment, setComment] = useState("");
  const key = JSON.stringify(resource);
  const loader = context?.load;
  const refresh = useCallback(async () => {
    if (loader)
      try {
        setData(await loader(JSON.parse(key)));
      } catch (e) {
        setError((e as Error).message);
      }
  }, [key, loader]);
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);
  if (!context) return null;
  async function save(input: WorkspaceMutation) {
    setBusy(true);
    setError("");
    try {
      await context!.mutate(input);
      await refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const task = data?.task;
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 5242880) {
      setError("Choose a file no larger than 5 MB.");
      return;
    }
    try {
      const raw = await file.arrayBuffer();
      let binary = "";
      for (const b of new Uint8Array(raw)) binary += String.fromCharCode(b);
      await save({
        action: "add",
        resource,
        id: crypto.randomUUID(),
        kind: "file",
        text: file.name,
        fileData: btoa(binary),
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="item-collaboration" aria-label="Shared item details">
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p>Loading shared details…</p>}
      <fieldset disabled={busy || !context.canEdit}>
        {task?.type === "task" && (
          <div className="workspace-task-details">
            <h3>Responsibility & timing</h3>
            {includePlacement && (
              <label>
                Task name
                <input
                  key={task.id}
                  defaultValue={task.text}
                  maxLength={1000}
                  onBlur={(e) => {
                    if (
                      e.target.value.trim() &&
                      e.target.value.trim() !== task.text
                    )
                      void save({
                        action: "task",
                        resource: { itemId: task.id },
                        text: e.target.value.trim(),
                      });
                  }}
                />
              </label>
            )}
            <label>
              Responsible person
              <select
                value={task.responsibleMemberId ?? ""}
                onChange={(e) =>
                  void save({
                    action: "task",
                    resource: { itemId: task.id },
                    responsibleMemberId: e.target.value || null,
                  })
                }
              >
                <option value="">Unassigned</option>
                {context.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {!task.responsibleMemberId && (
              <button
                type="button"
                onClick={() =>
                  void save({
                    action: "task",
                    resource: { itemId: task.id },
                    claim: true,
                  })
                }
              >
                I’ll take this
              </button>
            )}
            <label>
              Must be done by
              <input
                type="date"
                value={task.deadline ?? ""}
                onChange={(e) =>
                  void save({
                    action: "task",
                    resource: { itemId: task.id },
                    deadline: e.target.value || null,
                  })
                }
              />
            </label>
            {includePlacement && (
              <>
                <label>
                  Placement
                  <select
                    value={
                      task.isBacklog
                        ? "backlog"
                        : task.planningDate
                          ? "day"
                          : "week"
                    }
                    onChange={(e) =>
                      void save({
                        action: "task",
                        resource: { itemId: task.id },
                        isBacklog: e.target.value === "backlog",
                        planningDate:
                          e.target.value === "day" ? context.week : null,
                        weekStartDate: context.week,
                      })
                    }
                  >
                    <option value="backlog">Unscheduled backlog</option>
                    <option value="week">This selected week</option>
                    <option value="day">Choose a day</option>
                  </select>
                </label>
                {!task.isBacklog && task.planningDate && (
                  <label>
                    Plan to do on
                    <input
                      type="date"
                      value={task.planningDate}
                      onChange={(e) => {
                        if (e.target.value)
                          void save({
                            action: "task",
                            resource: { itemId: task.id },
                            planningDate: e.target.value,
                          });
                      }}
                    />
                  </label>
                )}
              </>
            )}
            <label className="workspace-check">
              <input
                type="checkbox"
                checked={task.isCompleted}
                onChange={(e) =>
                  void save({
                    action: "task",
                    resource: { itemId: task.id },
                    isCompleted: e.target.checked,
                  })
                }
              />
              Task complete
            </label>
          </div>
        )}
        <h3>Checklist</h3>
        {data?.entries
          .filter((e) => e.kind === "checklist")
          .map((e) => (
            <div className="workspace-entry" key={e.id}>
              <label className="workspace-check">
                <input
                  type="checkbox"
                  checked={e.completed}
                  onChange={(ev) =>
                    void save({
                      action: "check",
                      resource,
                      id: e.id,
                      completed: ev.target.checked,
                    })
                  }
                />
                <span
                  style={{
                    textDecoration: e.completed ? "line-through" : undefined,
                  }}
                >
                  {e.text}
                </span>
              </label>
              <button
                type="button"
                aria-label={`Remove ${e.text}`}
                onClick={() =>
                  void save({ action: "remove", resource, id: e.id })
                }
              >
                ×
              </button>
            </div>
          ))}
        {context.canEdit && (
          <div className="workspace-capture">
            <input
              aria-label="Checklist step"
              placeholder="Add a step"
              value={check}
              maxLength={1000}
              onChange={(e) => setCheck(e.target.value)}
            />
            <button
              type="button"
              disabled={!check.trim()}
              onClick={async () => {
                if (
                  await save({
                    action: "add",
                    resource,
                    id: crypto.randomUUID(),
                    kind: "checklist",
                    text: check.trim(),
                  })
                )
                  setCheck("");
              }}
            >
              Add step
            </button>
          </div>
        )}
        <h3>Discussion</h3>
        {data?.entries
          .filter((e) => e.kind === "comment")
          .map((e) => (
            <article className="workspace-comment" key={e.id}>
              <small>
                {e.author} · {new Date(e.createdAt).toLocaleString()}
              </small>
              <p>{e.text}</p>
              {e.createdBy === context.userId && (
                <button
                  type="button"
                  onClick={() =>
                    void save({ action: "remove", resource, id: e.id })
                  }
                >
                  Remove comment
                </button>
              )}
            </article>
          ))}
        {context.canEdit && (
          <>
            <textarea
              aria-label="Comment"
              placeholder="Leave a note for the household"
              value={comment}
              maxLength={4000}
              onChange={(e) => setComment(e.target.value)}
            />
            <button
              type="button"
              disabled={!comment.trim()}
              onClick={async () => {
                if (
                  await save({
                    action: "add",
                    resource,
                    id: crypto.randomUUID(),
                    kind: "comment",
                    text: comment.trim(),
                  })
                )
                  setComment("");
              }}
            >
              Post comment
            </button>
          </>
        )}
      </fieldset>
      <h3>Files</h3>
      <p className="muted">
        Shared with people who can view this item. Up to 5 MB per file.
      </p>
      {data?.entries
        .filter((e) => e.kind === "file")
        .map((e) => (
          <div className="workspace-entry" key={e.id}>
            <button
              type="button"
              onClick={() =>
                void context.download(e).catch((e) => setError(e.message))
              }
            >
              {e.text}
            </button>
            {context.canEdit && e.createdBy === context.userId && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void save({ action: "remove", resource, id: e.id })
                }
              >
                Remove
              </button>
            )}
          </div>
        ))}
      {context.canEdit && (
        <label>
          Attach a file
          <input
            type="file"
            disabled={busy}
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      )}
    </section>
  );
}

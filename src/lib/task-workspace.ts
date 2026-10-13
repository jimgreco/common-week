import { z } from "zod";
import { isDateOnly } from "@/lib/date";

export interface TaskRecord {
  id: string;
  text: string;
  type: "task" | "note";
  responsibleMemberId: string | null;
  deadline: string | null;
  isBacklog: boolean;
  planningDate: string | null;
  weekStartDate: string;
  isCompleted: boolean;
}
export interface CollaborationEntry {
  id: string;
  kind: "checklist" | "comment" | "file";
  text: string;
  completed: boolean;
  createdBy: string | null;
  author: string;
  createdAt: string;
}
export interface TaskWorkspaceData {
  tasks: TaskRecord[];
  entries: CollaborationEntry[];
  task: TaskRecord | null;
}
export type ItemResource =
  | { itemId: string }
  | { calendarId: string; eventId: string };
const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const date = z
  .string()
  .refine(
    (value) =>
      isDateOnly(value) &&
      new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value,
    "Choose a valid date.",
  );
export const itemResourceSchema = z.union([
  z.object({ itemId: uuid }),
  z.object({ calendarId: uuid, eventId: z.string().min(1).max(1024) }),
]);
export const workspaceMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("capture"),
    text: z.string().trim().min(1).max(1000),
    id: uuid,
  }),
  z.object({
    action: z.literal("task"),
    text: z.string().trim().min(1).max(1000).optional(),
    resource: z.object({ itemId: uuid }),
    responsibleMemberId: uuid.nullable().optional(),
    deadline: date.nullable().optional(),
    isBacklog: z.boolean().optional(),
    planningDate: date.nullable().optional(),
    weekStartDate: date.optional(),
    isCompleted: z.boolean().optional(),
    claim: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("add"),
    resource: itemResourceSchema,
    id: uuid,
    kind: z.enum(["checklist", "comment", "file"]),
    text: z.string().trim().min(1).max(4000),
    fileData: z.string().max(6990508).optional(),
  }),
  z.object({
    action: z.literal("check"),
    resource: itemResourceSchema,
    id: uuid,
    completed: z.boolean(),
  }),
  z.object({
    action: z.literal("remove"),
    resource: itemResourceSchema,
    id: uuid,
  }),
]);
export type WorkspaceMutation = z.infer<typeof workspaceMutationSchema>;

/** Keep a create's identity until its response is confirmed, including lost responses. */
export class WorkspaceCreateAttempts {
  private attempts = new Map<string, string>();

  prepare<T extends WorkspaceMutation>(input: T): T {
    if (input.action !== "capture" && input.action !== "add") return input;
    const signature = this.signature(input);
    const id = this.attempts.get(signature) ?? input.id;
    this.attempts.set(signature, id);
    return { ...input, id };
  }

  complete(input: WorkspaceMutation) {
    if (input.action !== "capture" && input.action !== "add") return;
    const signature = this.signature(input);
    if (this.attempts.get(signature) === input.id) this.attempts.delete(signature);
  }

  private signature(input: Extract<WorkspaceMutation, { action: "capture" | "add" }>) {
    return JSON.stringify(input.action === "capture"
      ? [input.action, input.text]
      : [input.action, "itemId" in input.resource ? input.resource.itemId : [input.resource.calendarId, input.resource.eventId], input.kind, input.text, input.fileData]);
  }
}

export function taskMatchesFilter(
  task: TaskRecord,
  filter: string,
  userId: string,
  today: string,
  query = "",
): boolean {
  if (!task.text.toLowerCase().includes(query.trim().toLowerCase())) return false;
  if (filter === "Completed") return task.isCompleted;
  if (task.isCompleted) return false;
  if (filter === "Mine") return task.responsibleMemberId === userId;
  if (filter === "Unassigned") return !task.responsibleMemberId;
  if (filter === "Backlog") return task.isBacklog;
  if (filter === "Overdue") return !!task.deadline && task.deadline < today;
  return true;
}

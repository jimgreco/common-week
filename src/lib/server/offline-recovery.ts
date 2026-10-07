import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { isDateOnly, weekStartForDate } from "@/lib/date";
import { withTransaction } from "@/lib/server/database";
import { hashSessionToken } from "@/lib/server/session";

const date = z.string().refine((value) => isDateOnly(value) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value);
export const recoverySchema = z.object({
  action: z.enum(["review", "recover"]),
  originalUserId: z.string().uuid(),
  originalHouseholdId: z.string().uuid(),
  sourceMutationId: z.string().uuid(),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  draft: z.object({
    id: z.string().uuid(),
    text: z.string().min(1).max(1000).refine((value) => value.trim().length > 0),
    type: z.enum(["note", "task"]),
    planningDate: date.nullable(),
    weekStartDate: date,
  }).strict(),
}).strict().refine(({ draft }) => {
  // Object refinements can run even after an inner date refinement failed.
  if (!isDateOnly(draft.weekStartDate) || (draft.planningDate && !isDateOnly(draft.planningDate))) return false;
  return weekStartForDate(draft.weekStartDate) === draft.weekStartDate
    && (!draft.planningDate || weekStartForDate(draft.planningDate) === draft.weekStartDate);
});
export type RecoveryInput = z.infer<typeof recoverySchema>;

type CurrentItem = { id: string; text: string; type: string; planningDate: string | null; weekStartDate: string; isCompleted: boolean };
export type RecoveryResult = { status: "ready" | "existing" | "recovered" | "conflict"; item?: CurrentItem };

// Both actions reauthorize under locks in the same transaction as the read/write.
// The household lock also serializes recovery retries with ordinary creates.
export async function recoverOfflineDraft(token: string, input: RecoveryInput): Promise<RecoveryResult> {
  return withTransaction(async (db) => {
    const membership = await db.query<{ role: string }>(
      `select hm.role from auth_sessions s join household_members hm on hm.user_id=s.user_id
       where s.token_hash=$1 and s.expires_at>now() and s.user_id=$2 and hm.household_id=$3
       for share of s, hm`,
      [hashSessionToken(token), input.originalUserId, input.originalHouseholdId],
    );
    if (!membership.rows[0]) throw new Error("Your account or household changed. Verify the original identity again.");
    if (input.action === "recover" && membership.rows[0].role === "viewer") throw new Error("This household is read-only.");
    await db.query("select id from households where id=$1 for update", [input.originalHouseholdId]);
    const draftDigest = createHash("sha256").update(JSON.stringify(input.draft)).digest("hex");
    const receipt = await db.query<{ household_id: string; source_digest: string; draft_digest: string; item_id: string }>(
      "select household_id,source_digest,draft_digest,item_id from offline_draft_recoveries where user_id=$1 and (source_mutation_id=$2 or item_id=$3)",
      [input.originalUserId, input.sourceMutationId, input.draft.id],
    );
    const saved = receipt.rows[0];
    if (saved) {
      // Never return another household's item or reuse a receipt for changed bytes.
      return { status: saved.household_id === input.originalHouseholdId && saved.source_digest === input.sourceDigest
        && saved.draft_digest === draftDigest && saved.item_id === input.draft.id ? "recovered" : "conflict" };
    }
    const current = await db.query<CurrentItem>(
      `select id,text,type,planning_date::text as "planningDate",week_start_date::text as "weekStartDate",is_completed as "isCompleted"
       from planning_items where id=$1 and household_id=$2`, [input.draft.id, input.originalHouseholdId],
    );
    if (current.rows[0]) return { status: "existing", item: current.rows[0] };
    if (input.action === "review") return { status: "ready" };
    // Same ID as the source create. ON CONFLICT never overwrites any household.
    const inserted = await db.query(
      `insert into planning_items(id,household_id,created_by,text,type,planning_date,week_start_date,sort_order,assigned_member_ids)
       values($1,$2,$3,$4,$5,$6,$7,coalesce((select max(sort_order)+1 from planning_items where household_id=$2),0),'{}'::uuid[])
       on conflict(id) do nothing returning id`,
      [input.draft.id, input.originalHouseholdId, input.originalUserId, input.draft.text, input.draft.type, input.draft.planningDate, input.draft.weekStartDate],
    );
    if (!inserted.rowCount) return { status: "conflict" };
    await db.query(
      `insert into offline_draft_recoveries(user_id,source_mutation_id,household_id,source_digest,draft_digest,item_id) values($1,$2,$3,$4,$5,$6)`,
      [input.originalUserId, input.sourceMutationId, input.originalHouseholdId, input.sourceDigest, draftDigest, input.draft.id],
    );
    // No old assignments, reminders, locations, notifications, or provider work.
    return { status: "recovered" };
  });
}

"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { requireUserContext } from "@/lib/server/auth";
import { withTransaction } from "@/lib/server/database";

export async function acceptInvitationAction(token: string) {
  const context = await requireUserContext();
  if (context.householdId) redirect("/planner");
  const hash = createHash("sha256").update(token).digest();
  const accepted = await withTransaction(async (database) => {
    const invite = await database.query<{ id: string; household_id: string; email: string }>(
      `select id, household_id, email::text from household_invitations
        where token_hash = $1 and status = 'pending' and expires_at > now() for update`,
      [hash],
    );
    const row = invite.rows[0];
    if (!row || row.email.toLowerCase() !== context.email.toLowerCase()) return false;
    await database.query("insert into household_members (household_id, user_id, role) values ($1, $2, 'member')", [row.household_id, context.userId]);
    await database.query("update household_invitations set status = 'accepted', accepted_at = now(), token_hash = null where id = $1", [row.id]);
    return true;
  });
  redirect(accepted ? "/planner" : `/invite/${token}?error=account`);
}

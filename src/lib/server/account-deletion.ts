import "server-only";

import { revokeAppleRefreshToken } from "@/lib/server/apple-auth";
import { query, withTransaction } from "@/lib/server/database";
import { decryptProviderToken } from "@/lib/server/token-crypto";

async function revokeGoogleToken(encrypted: string | null) {
  if (!encrypted) return;
  const token = decryptProviderToken(encrypted);
  const response = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, cache: "no-store",
  });
  if (!response.ok && response.status !== 400) throw new Error("Google authorization could not be revoked.");
}

export async function permanentlyDeleteUser(userId: string) {
  const ownership = await query<{ role: string; member_count: number }>(
    `select hm.role, (select count(*)::int from household_members where household_id = hm.household_id) as member_count
       from household_members hm where hm.user_id = $1`,
    [userId],
  );
  if (ownership.rows[0]?.role === "owner" && ownership.rows[0].member_count > 1) {
    throw new Error("Transfer household ownership before deleting your account.");
  }
  const credentials = await query<{
    google_refresh: string | null;
    google_access: string | null;
    apple_refresh: string | null;
    apple_client_id: string | null;
  }>(
    `select gc.refresh_token_encrypted as google_refresh, gc.access_token_encrypted as google_access,
            ac.refresh_token_encrypted as apple_refresh, ac.client_id as apple_client_id
       from users u left join google_connections gc on gc.user_id = u.id
       left join apple_connections ac on ac.user_id = u.id where u.id = $1`,
    [userId],
  );
  await withTransaction(async (database) => {
    const membership = await database.query<{ household_id: string; role: string; member_count: number }>(
      `select hm.household_id, hm.role,
              (select count(*)::int from household_members where household_id = hm.household_id) as member_count
         from household_members hm where hm.user_id = $1 for update`,
      [userId],
    );
    const row = membership.rows[0];
    if (row?.role === "owner" && row.member_count > 1) throw new Error("Transfer household ownership before deleting your account.");
    if (row?.role === "owner") {
      await database.query("delete from households where id = $1", [row.household_id]);
    } else {
      await database.query("delete from planning_items where created_by = $1", [userId]);
    }
    await database.query("delete from users where id = $1", [userId]);
  });

  const credential = credentials.rows[0];
  const results = await Promise.allSettled([
    revokeGoogleToken(credential?.google_refresh || credential?.google_access || null),
    credential?.apple_refresh && credential.apple_client_id
      ? revokeAppleRefreshToken(decryptProviderToken(credential.apple_refresh), credential.apple_client_id)
      : Promise.resolve(),
  ]);
  for (const result of results) if (result.status === "rejected") console.warn("Provider revocation failed during account deletion", result.reason instanceof Error ? result.reason.message : "UnknownError");
}

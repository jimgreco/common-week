import "server-only";

import type { PoolClient } from "pg";
import { z } from "zod";

const pendingGoogleConnectionSchema = z.object({
  subject: z.string().min(1).max(255),
  accessTokenEncrypted: z.string().min(1),
  refreshTokenEncrypted: z.string().min(1).nullable(),
  expiresAt: z.string().datetime(),
  scope: z.string(),
});

export type PendingGoogleConnection = z.infer<typeof pendingGoogleConnectionSchema>;

export async function finalizeGoogleConnection(database: PoolClient, userId: string, raw: unknown) {
  const pending = pendingGoogleConnectionSchema.parse(raw);
  // Serialize connections to the same account, then let the unique subject
  // constraint arbitrate simultaneous attempts from different accounts.
  await database.query("select id from users where id = $1 for update", [userId]);
  const current = await database.query<{ provider_subject: string }>(
    "select provider_subject from user_identities where user_id = $1 and provider = 'google'",
    [userId],
  );
  if (current.rows[0] && current.rows[0].provider_subject !== pending.subject) {
    throw new Error("Choose the Google account already connected to Week of Us.");
  }
  const identity = await database.query<{ user_id: string }>(
    `insert into user_identities (user_id, provider, provider_subject)
     values ($1, 'google', $2)
     on conflict (provider, provider_subject) do update set updated_at = now()
       where user_identities.user_id = excluded.user_id
     returning user_id`,
    [userId, pending.subject],
  );
  if (identity.rows[0]?.user_id !== userId) {
    throw new Error("That Google account is already connected to another Week of Us account.");
  }
  await database.query("update users set google_subject = $2, updated_at = now() where id = $1", [userId, pending.subject]);
  await database.query(
    `insert into google_connections (user_id, access_token_encrypted, refresh_token_encrypted, expires_at, scope)
     values ($1, $2, $3, $4, $5)
     on conflict (user_id) do update set
       access_token_encrypted = excluded.access_token_encrypted,
       refresh_token_encrypted = coalesce(excluded.refresh_token_encrypted, google_connections.refresh_token_encrypted),
       expires_at = excluded.expires_at, scope = excluded.scope`,
    [userId, pending.accessTokenEncrypted, pending.refreshTokenEncrypted, new Date(pending.expiresAt), pending.scope],
  );
  await database.query("delete from calendar_event_cache where user_id = $1", [userId]);
}

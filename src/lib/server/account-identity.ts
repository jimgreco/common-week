import "server-only";

import type { PoolClient } from "pg";

export async function findOrCreateProviderUser(
  database: PoolClient,
  input: {
    provider: "google" | "apple";
    subject: string;
    email: string;
    displayName: string;
    avatarUrl?: string | null;
  },
): Promise<string> {
  const existingIdentity = await database.query<{ user_id: string }>(
    "select user_id from user_identities where provider = $1 and provider_subject = $2 for update",
    [input.provider, input.subject],
  );
  let userId = existingIdentity.rows[0]?.user_id;

  if (!userId) {
    const existingEmail = await database.query<{ id: string }>(
      "select id from users where email = $1 for update",
      [input.email],
    );
    if (existingEmail.rows[0]) {
      userId = existingEmail.rows[0].id;
    } else {
      const created = await database.query<{ id: string }>(
        `insert into users (google_subject, email, display_name, avatar_url)
         values ($1, $2, $3, $4) returning id`,
        [input.provider === "google" ? input.subject : null, input.email, input.displayName, input.avatarUrl ?? null],
      );
      userId = created.rows[0].id;
    }
    await database.query(
      `insert into user_identities (user_id, provider, provider_subject)
       values ($1, $2, $3)
       on conflict (provider, provider_subject) do update set user_id = excluded.user_id, updated_at = now()`,
      [userId, input.provider, input.subject],
    );
  }

  await database.query(
    `update users set
       email = $2,
       display_name = case when $3 = '' then display_name else $3 end,
       avatar_url = coalesce($4, avatar_url),
       google_subject = case when $5 = 'google' then $6 else google_subject end,
       updated_at = now()
     where id = $1`,
    [userId, input.email, input.displayName, input.avatarUrl ?? null, input.provider, input.subject],
  );
  return userId;
}

export async function acceptPendingInvitation(database: PoolClient, userId: string, email: string) {
  const membership = await database.query<{ household_id: string }>(
    "select household_id from household_members where user_id = $1",
    [userId],
  );
  if (membership.rows[0]) return membership.rows[0].household_id;

  const invitation = await database.query<{ id: string; household_id: string }>(
    `select id, household_id from household_invitations
      where email = $1 and status = 'pending' and expires_at > now()
      order by created_at desc limit 1 for update skip locked`,
    [email],
  );
  if (!invitation.rows[0]) return null;
  await database.query(
    "insert into household_members (household_id, user_id, role) values ($1, $2, 'member')",
    [invitation.rows[0].household_id, userId],
  );
  await database.query(
    "update household_invitations set status = 'accepted', accepted_at = now() where id = $1",
    [invitation.rows[0].id],
  );
  return invitation.rows[0].household_id;
}

import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { PoolClient } from "pg";
import { shouldUseSecureCookies } from "@/lib/env";
import { query } from "@/lib/server/database";

export const SESSION_COOKIE = "common_week_session";
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionIdentity {
  userId: string;
  email: string;
  displayName: string;
  householdId: string | null;
  role: "owner" | "member" | "viewer" | null;
}

export function hashSessionToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: shouldUseSecureCookies(),
    sameSite: "lax" as const,
    path: "/",
    expires,
    priority: "high" as const,
  };
}

export async function createDatabaseSession(client: PoolClient, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_LIFETIME_MS);
  await client.query("delete from auth_sessions where expires_at <= now()");
  await client.query(
    "insert into auth_sessions (token_hash, user_id, expires_at) values ($1, $2, $3)",
    [hashSessionToken(token), userId, expires],
  );
  return { token, expires };
}

export async function sessionIdentityForToken(token: string | undefined): Promise<SessionIdentity | null> {
  if (!token || token.length > 128) return null;
  const result = await query<{
    user_id: string;
    email: string;
    display_name: string;
    household_id: string | null;
    role: SessionIdentity["role"];
  }>(
    `select u.id as user_id, u.email::text, u.display_name,
            hm.household_id, hm.role
       from auth_sessions s
       join users u on u.id = s.user_id
       left join household_members hm on hm.user_id = u.id
      where s.token_hash = $1 and s.expires_at > now()`,
    [hashSessionToken(token)],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    householdId: row.household_id,
    role: row.role,
  };
}

export async function currentSessionIdentity(): Promise<SessionIdentity | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return sessionIdentityForToken(token);
}

export async function deleteCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  try {
    if (token) await query("delete from auth_sessions where token_hash = $1", [hashSessionToken(token)]);
  } catch {
    console.error("Session revocation could not reach PostgreSQL; the browser cookie will still be cleared.");
  } finally {
    cookieStore.delete(SESSION_COOKIE);
  }
}

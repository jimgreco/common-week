import "server-only";

import { query } from "@/lib/server/database";
import { googleOAuthClient } from "@/lib/server/google-oauth";
import { decryptProviderToken, encryptProviderToken } from "@/lib/server/token-crypto";

interface GoogleConnection {
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  expires_at: Date | null;
  scope: string | null;
}

function isInvalidGrant(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { response?: { status?: number; data?: { error?: string } }; message?: string };
  return candidate.response?.status === 400 ||
    candidate.response?.status === 401 ||
    candidate.response?.data?.error === "invalid_grant" ||
    candidate.message?.includes("invalid_grant") === true;
}

export async function getGoogleAccessToken(userId: string): Promise<string | null> {
  const result = await query<GoogleConnection>(
    `select access_token_encrypted, refresh_token_encrypted, expires_at, scope
       from google_connections where user_id = $1`,
    [userId],
  );
  const connection = result.rows[0];
  if (!connection) return null;

  const expiresAt = connection.expires_at?.getTime() ?? 0;
  if (expiresAt > Date.now() + 60_000) return decryptProviderToken(connection.access_token_encrypted);
  if (!connection.refresh_token_encrypted) return null;

  try {
    const refreshToken = decryptProviderToken(connection.refresh_token_encrypted);
    const client = googleOAuthClient();
    client.setCredentials({ refresh_token: refreshToken });
    const refreshed = await client.refreshAccessToken();
    const accessToken = refreshed.credentials.access_token;
    if (!accessToken) throw new Error("Google did not return a refreshed access token.");
    const newExpiresAt = refreshed.credentials.expiry_date
      ? new Date(refreshed.credentials.expiry_date)
      : new Date(Date.now() + 55 * 60_000);
    await query(
      `update google_connections set
         access_token_encrypted = $2, expires_at = $3, scope = coalesce($4, scope)
       where user_id = $1`,
      [userId, encryptProviderToken(accessToken), newExpiresAt, refreshed.credentials.scope ?? null],
    );
    return accessToken;
  } catch (error) {
    if (isInvalidGrant(error)) {
      await query("delete from google_connections where user_id = $1", [userId]);
      return null;
    }
    throw new Error("Google authorization could not be refreshed.", { cause: error });
  }
}

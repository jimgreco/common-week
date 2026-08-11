import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

interface GoogleConnection {
  user_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scope: string | null;
}

export async function getGoogleAccessToken(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("google_connections")
    .select("user_id, access_token, refresh_token, expires_at, scope")
    .eq("user_id", userId)
    .maybeSingle<GoogleConnection>();

  if (error) throw new Error("Unable to read Google connection.");
  if (!data) return null;

  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 60_000) return data.access_token;
  if (!data.refresh_token) return null;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google OAuth server credentials are not configured.");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: data.refresh_token,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });

  if (!response.ok) {
    if (response.status === 400 || response.status === 401) {
      await admin.from("google_connections").delete().eq("user_id", userId);
      return null;
    }
    throw new Error("Google authorization could not be refreshed.");
  }

  const refreshed = (await response.json()) as { access_token: string; expires_in?: number; scope?: string };
  const newExpiresAt = new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString();
  const { error: updateError } = await admin
    .from("google_connections")
    .update({
      access_token: refreshed.access_token,
      expires_at: newExpiresAt,
      scope: refreshed.scope ?? data.scope,
    })
    .eq("user_id", userId);
  if (updateError) throw new Error("Google authorization was refreshed but could not be saved.");
  return refreshed.access_token;
}

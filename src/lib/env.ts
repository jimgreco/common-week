import "server-only";

export const isDatabaseConfigured = Boolean(process.env.DATABASE_URL);

export const isDemoMode = process.env.ENABLE_DEMO === "true" || !isDatabaseConfigured;

export const isGoogleOAuthConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY &&
    Buffer.from(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY, "base64").length === 32,
);

export const isAppleOAuthConfigured = Boolean(
  process.env.APPLE_TEAM_ID &&
  process.env.APPLE_KEY_ID &&
  (process.env.APPLE_PRIVATE_KEY || process.env.APPLE_PRIVATE_KEY_BASE64) &&
  process.env.APPLE_SERVICE_ID,
);

export function applicationOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const url = new URL(configured);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error("NEXT_PUBLIC_APP_URL must be a valid HTTP(S) origin.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:" && !local) {
    throw new Error("NEXT_PUBLIC_APP_URL must use HTTPS in production.");
  }
  return url.origin;
}

export function shouldUseSecureCookies(): boolean {
  if (process.env.SESSION_COOKIE_SECURE === "true") return true;
  if (process.env.SESSION_COOKIE_SECURE === "false") return false;
  return new URL(applicationOrigin()).protocol === "https:";
}

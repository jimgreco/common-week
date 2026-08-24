import "server-only";

import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from "jose";
import { applicationOrigin } from "@/lib/env";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_KEYS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
export const APPLE_STATE_COOKIE = "common_week_apple_state";
export const APPLE_NONCE_COOKIE = "common_week_apple_nonce";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function applePrivateKey(): string {
  const configured = process.env.APPLE_PRIVATE_KEY?.trim();
  if (configured) return configured.replace(/\\n/g, "\n");
  const encoded = process.env.APPLE_PRIVATE_KEY_BASE64?.trim();
  if (!encoded) throw new Error("APPLE_PRIVATE_KEY or APPLE_PRIVATE_KEY_BASE64 is not configured.");
  const decoded = Buffer.from(encoded, "base64").toString("utf8").trim();
  if (!decoded.includes("BEGIN PRIVATE KEY")) throw new Error("APPLE_PRIVATE_KEY_BASE64 is invalid.");
  return `${decoded}\n`;
}

export function appleWebClientId() { return required("APPLE_SERVICE_ID"); }
export function appleNativeClientId() { return process.env.APPLE_BUNDLE_ID?.trim() || "com.jimgreco.commonweek"; }
export function appleRedirectUri() { return new URL("/auth/apple/callback", applicationOrigin()).toString(); }

export function isAppleAuthConfigured(): boolean {
  return Boolean(process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID
    && (process.env.APPLE_PRIVATE_KEY || process.env.APPLE_PRIVATE_KEY_BASE64)
    && process.env.APPLE_SERVICE_ID);
}

async function clientSecret(clientId: string): Promise<string> {
  const key = await importPKCS8(applePrivateKey(), "ES256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: required("APPLE_KEY_ID") })
    .setIssuer(required("APPLE_TEAM_ID"))
    .setSubject(clientId)
    .setAudience(APPLE_ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + 5 * 60)
    .sign(key);
}

export async function verifyAppleIdentityToken(identityToken: string, clientId: string, nonce?: string) {
  const { payload } = await jwtVerify(identityToken, APPLE_KEYS, {
    issuer: APPLE_ISSUER,
    audience: clientId,
    algorithms: ["RS256"],
  });
  if (!payload.sub || typeof payload.email !== "string") throw new Error("Apple did not return an email address.");
  if (payload.email_verified !== true && payload.email_verified !== "true") throw new Error("Apple email is not verified.");
  if (nonce && payload.nonce !== nonce) throw new Error("Apple sign-in nonce did not match.");
  return { subject: payload.sub, email: payload.email.toLowerCase() };
}

export async function exchangeAppleAuthorizationCode(code: string, clientId: string, redirectUri?: string) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: await clientSecret(clientId),
    code,
    grant_type: "authorization_code",
  });
  if (redirectUri) body.set("redirect_uri", redirectUri);
  const response = await fetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const result = await response.json() as { id_token?: string; refresh_token?: string; error?: string };
  if (!response.ok || !result.id_token || !result.refresh_token) throw new Error(result.error || "Apple token exchange failed.");
  return { identityToken: result.id_token, refreshToken: result.refresh_token };
}

export async function revokeAppleRefreshToken(token: string, clientId: string): Promise<void> {
  const response = await fetch("https://appleid.apple.com/auth/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: await clientSecret(clientId),
      token,
      token_type_hint: "refresh_token",
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Apple authorization could not be revoked.");
}

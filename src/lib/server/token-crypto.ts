import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function encryptionKey(): Buffer {
  const encoded = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY is not configured.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return key;
}

export function encryptProviderToken(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptProviderToken(value: string): string {
  const [version, encodedIv, encodedTag, encodedCiphertext, extra] = value.split(".");
  if (version !== VERSION || !encodedIv || !encodedTag || !encodedCiphertext || extra) {
    throw new Error("Stored provider credentials are invalid.");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(encodedIv, "base64url"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

import { createHash } from "node:crypto";
import { z } from "zod";
import { acceptPendingInvitation, ensurePersonalHousehold, findOrCreateProviderUser } from "@/lib/server/account-identity";
import { appleNativeClientId, exchangeAppleAuthorizationCode, verifyAppleIdentityToken } from "@/lib/server/apple-auth";
import { withTransaction } from "@/lib/server/database";
import { createDatabaseSession } from "@/lib/server/session";
import { encryptProviderToken } from "@/lib/server/token-crypto";

export const runtime = "nodejs";

const schema = z.object({
  identityToken: z.string().min(100).max(20_000),
  authorizationCode: z.string().min(10).max(4_000),
  nonce: z.string().min(20).max(128),
  displayName: z.string().trim().max(120).optional(),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const clientId = appleNativeClientId();
    const expectedNonce = createHash("sha256").update(input.nonce).digest("hex");
    const posted = await verifyAppleIdentityToken(input.identityToken, clientId, expectedNonce);
    const exchanged = await exchangeAppleAuthorizationCode(input.authorizationCode, clientId);
    const verified = await verifyAppleIdentityToken(exchanged.identityToken, clientId, expectedNonce);
    if (posted.subject !== verified.subject) throw new Error("Apple identity mismatch.");
    const session = await withTransaction(async (database) => {
      const userId = await findOrCreateProviderUser(database, {
        provider: "apple",
        subject: verified.subject,
        email: verified.email,
        displayName: input.displayName || verified.email.split("@")[0] || "Family member",
      });
      await database.query(
        `insert into apple_connections (user_id, refresh_token_encrypted, client_id)
         values ($1, $2, $3)
         on conflict (user_id) do update set refresh_token_encrypted = excluded.refresh_token_encrypted,
           client_id = excluded.client_id, updated_at = now()`,
        [userId, encryptProviderToken(exchanged.refreshToken), clientId],
      );
      const householdId = await acceptPendingInvitation(database, userId, verified.email);
      if (!householdId) await ensurePersonalHousehold(database, userId, input.displayName ?? "");
      return createDatabaseSession(database, userId);
    });
    return Response.json({ ok: true, data: { token: session.token, expiresAt: session.expires.toISOString() } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Native Apple sign-in failed", error instanceof Error ? error.message : "UnknownError");
    return Response.json({ ok: false, error: "Apple sign-in could not be completed." }, { status: 400 });
  }
}

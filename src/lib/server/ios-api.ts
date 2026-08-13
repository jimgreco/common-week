import "server-only";

import type { NextRequest } from "next/server";
import { bearerTokenForAuthorization } from "@/lib/auth-token";
import { sessionIdentityForToken } from "@/lib/server/session";

export async function requireIOSIdentity(request: NextRequest) {
  const token = bearerTokenForAuthorization(request.headers.get("authorization"));
  const identity = await sessionIdentityForToken(token);
  if (!identity) return null;
  return { identity, token: token! };
}

export function actionResponse(result: { ok: boolean; error?: string; data?: unknown }) {
  return Response.json(result, {
    status: result.ok ? 200 : 400,
    headers: { "Cache-Control": "no-store" },
  });
}

export function unauthorizedResponse() {
  return Response.json({ ok: false, error: "Authentication required." }, {
    status: 401,
    headers: { "Cache-Control": "no-store" },
  });
}

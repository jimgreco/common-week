import { z } from "zod";
import { bearerTokenForAuthorization } from "@/lib/auth-token";
import { exchangeNativeAuthorizationCode, sessionIdentityForToken } from "@/lib/server/session";

export const runtime = "nodejs";

const exchangeSchema = z.object({
  code: z.string().min(20).max(128).regex(/^[A-Za-z0-9_-]+$/),
  state: z.string().min(20).max(128).regex(/^[A-Za-z0-9_-]+$/),
});

export async function POST(request: Request) {
  try {
    const input = exchangeSchema.parse(await request.json());
    const identity = await sessionIdentityForToken(bearerTokenForAuthorization(request.headers.get("authorization")));
    const session = await exchangeNativeAuthorizationCode(input.code, input.state, identity?.userId);
    if (!session) return Response.json({ ok: false, error: "Sign-in expired, or Calendar connection requires the current signed-in app. Update the app and start again." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    return Response.json({ ok: true, data: { token: session.token, expiresAt: session.expires.toISOString() } }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ ok: false, error: "The sign-in response was invalid." }, { status: 400 });
  }
}

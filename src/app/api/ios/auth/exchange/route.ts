import { z } from "zod";
import { exchangeNativeAuthorizationCode } from "@/lib/server/session";

export const runtime = "nodejs";

const exchangeSchema = z.object({
  code: z.string().min(20).max(128).regex(/^[A-Za-z0-9_-]+$/),
  state: z.string().min(20).max(128).regex(/^[A-Za-z0-9_-]+$/),
});

export async function POST(request: Request) {
  try {
    const input = exchangeSchema.parse(await request.json());
    const session = await exchangeNativeAuthorizationCode(input.code, input.state);
    if (!session) return Response.json({ ok: false, error: "Sign-in expired. Please try again." }, { status: 401 });
    return Response.json({ ok: true, data: { token: session.token, expiresAt: session.expires.toISOString() } }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ ok: false, error: "The sign-in response was invalid." }, { status: 400 });
  }
}

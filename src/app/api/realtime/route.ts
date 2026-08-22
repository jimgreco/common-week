import { type NextRequest } from "next/server";
import { bearerTokenForAuthorization } from "@/lib/auth-token";
import { getRealtimeHub } from "@/lib/server/realtime";
import { SESSION_COOKIE, sessionIdentityForToken } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value
    ?? bearerTokenForAuthorization(request.headers.get("authorization"));
  const identity = await sessionIdentityForToken(token);
  if (!identity?.householdId) return new Response(null, { status: 401 });
  const householdId = identity.householdId;

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe = () => {};
  let closed = false;
  let close = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        request.signal.removeEventListener("abort", close);
        unsubscribe();
        try { controller.close(); } catch {}
      };
      try {
        unsubscribe = await getRealtimeHub().subscribe(householdId, (table) => {
          if (!closed) controller.enqueue(encoder.encode(`event: change\ndata: ${JSON.stringify({ table })}\n\n`));
        });
        request.signal.addEventListener("abort", close, { once: true });
        controller.enqueue(encoder.encode("event: ready\ndata: {}\n\n"));
        heartbeat = setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode(": keep-alive\n\n"));
        }, 20_000);
      } catch (error) {
        closed = true;
        unsubscribe();
        controller.error(error);
      }
    },
    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-store, no-transform",
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

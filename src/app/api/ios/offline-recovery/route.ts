import type { NextRequest } from "next/server";
import { requireIOSIdentity, unauthorizedResponse } from "@/lib/server/ios-api";
import { recoverySchema, recoverOfflineDraft } from "@/lib/server/offline-recovery";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const session = await requireIOSIdentity(request);
  if (!session) return unauthorizedResponse();
  const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  // Native drafts never need more than a few KiB. Bound bytes before parsing.
  const reader = request.body?.getReader();
  if (!reader) return respond({ ok: false, error: "A saved draft is required." }, 400);
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16_384) { await reader.cancel(); return respond({ ok: false, error: "This draft is too large. Export it for review." }, 413); }
      chunks.push(value);
    }
    const parsed = recoverySchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) return respond({ ok: false, error: "This draft needs manual review. Export the original file." }, 400);
    const input = parsed.data;
    if (input.originalUserId !== session.identity.userId || input.originalHouseholdId !== session.identity.householdId
      || request.headers.get("x-week-of-us-user") !== input.originalUserId
      || request.headers.get("x-week-of-us-household") !== input.originalHouseholdId) {
      return respond({ ok: false, error: "Your account or household changed. Verify the original identity again." }, 409);
    }
    const result = await recoverOfflineDraft(session.token, input);
    return respond({ ok: true, data: result });
  } catch {
    return respond({ ok: false, error: "Recovery could not be completed. Verify your account and household, then review again. The original file is unchanged." }, 409);
  } finally { reader.releaseLock(); }
}

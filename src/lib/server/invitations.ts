import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { applicationOrigin } from "@/lib/env";
import { query } from "@/lib/server/database";

export function invitationToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest() };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
}

export async function deliverInvitation(input: {
  id: string;
  email: string;
  householdName: string;
  inviterName: string;
  token: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.INVITATION_EMAIL_FROM;
  if (!apiKey || !from) {
    await query("update household_invitations set delivery_error = $2 where id = $1", [input.id, "Email delivery is not configured."]);
    throw new Error("Invitation saved, but email delivery is not configured.");
  }
  const url = new URL(`/invite/${input.token}`, applicationOrigin()).toString();
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `week-of-us-invite-${input.id}-${input.token.slice(0, 12)}`,
    },
    body: JSON.stringify({
      from,
      to: [input.email],
      subject: `${input.inviterName} invited you to ${input.householdName} on Week of Us`,
      text: `${input.inviterName} invited you to share ${input.householdName}'s weekly planner. Accept the invitation: ${url}\n\nThis link expires in 14 days.`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:32px"><h1 style="font-size:26px">Your week, together.</h1><p><strong>${escapeHtml(input.inviterName)}</strong> invited you to share <strong>${escapeHtml(input.householdName)}</strong> on Week of Us.</p><p><a href="${url}" style="display:inline-block;background:#18231f;color:white;padding:12px 18px;border-radius:9px;text-decoration:none">Accept invitation</a></p><p style="color:#66706b;font-size:13px">This private link expires in 14 days. Sign in with the invited email address.</p></div>`,
      tags: [{ name: "message_type", value: "household_invitation" }],
    }),
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({})) as { id?: string; message?: string };
  if (!response.ok || !result.id) {
    const message = result.message || "Invitation email could not be delivered.";
    await query("update household_invitations set delivery_error = $2 where id = $1", [input.id, message.slice(0, 500)]);
    throw new Error("Invitation saved, but the email could not be delivered. You can resend it.");
  }
  await query(
    "update household_invitations set sent_at = now(), delivery_id = $2, delivery_error = null where id = $1",
    [input.id, result.id],
  );
}

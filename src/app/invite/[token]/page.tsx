import { createHash } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { getUserContext } from "@/lib/server/auth";
import { query } from "@/lib/server/database";
import { acceptInvitationAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function InvitationPage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(token)) notFound();
  const result = await query<{ email: string; household_name: string; inviter_name: string; expires_at: Date }>(
    `select i.email::text, h.name as household_name, u.display_name as inviter_name, i.expires_at
       from household_invitations i join households h on h.id = i.household_id join users u on u.id = i.invited_by
      where i.token_hash = $1 and i.status = 'pending' and i.expires_at > now()`,
    [createHash("sha256").update(token).digest()],
  );
  const invitation = result.rows[0];
  if (!invitation) notFound();
  const context = await getUserContext();
  const wrongAccount = context && context.email.toLowerCase() !== invitation.email.toLowerCase();
  const { error } = await searchParams;
  return (
    <main className="auth-shell">
      <section className="auth-card invitation-card">
        <BrandMark />
        <p className="eyebrow">Household invitation</p>
        <h1>Join {invitation.household_name}</h1>
        <p>{invitation.inviter_name} invited <strong>{invitation.email}</strong> to share their weekly planner.</p>
        {wrongAccount || error ? <p className="form-error">Sign in as {invitation.email} to accept this invitation.</p> : null}
        {context && !wrongAccount ? (
          <form action={acceptInvitationAction.bind(null, token)}><button className="button button-primary button-large">Accept invitation</button></form>
        ) : (
          <div className="landing-actions">
            <a className="button button-primary" href="/auth/apple">Continue with Apple</a>
            <a className="button button-secondary" href="/auth/google">Continue with Google</a>
          </div>
        )}
        <small>This private invitation expires {invitation.expires_at.toLocaleDateString("en-US", { dateStyle: "medium" })}.</small>
        <Link href="/privacy">Privacy</Link>
      </section>
    </main>
  );
}

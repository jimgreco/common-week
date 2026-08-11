"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function appOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) return "http://localhost:3000";
  const url = new URL(configured);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Invalid application origin.");
  return url.origin;
}

export async function signInWithGoogle() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${appOrigin()}/auth/callback?next=/planner`,
      scopes: "openid email profile https://www.googleapis.com/auth/calendar.readonly",
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });
  if (error || !data.url) redirect("/?auth_error=google");
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

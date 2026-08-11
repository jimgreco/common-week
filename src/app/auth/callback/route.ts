import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/planner";
  return value;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/?auth_error=missing_code", request.url));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(new URL("/?auth_error=callback", request.url));
  }

  try {
    const admin = createAdminClient();
    const connection = {
      user_id: data.user.id,
      access_token: data.session.provider_token ?? "",
      expires_at: new Date(Date.now() + 55 * 60_000).toISOString(),
      scope: "openid email profile https://www.googleapis.com/auth/calendar.readonly",
    };
    if (connection.access_token) {
      if (data.session.provider_refresh_token) {
        await admin.from("google_connections").upsert(
          { ...connection, refresh_token: data.session.provider_refresh_token },
          { onConflict: "user_id" },
        );
      } else {
        const { data: existing } = await admin
          .from("google_connections")
          .select("user_id")
          .eq("user_id", data.user.id)
          .maybeSingle();
        if (existing) {
          await admin.from("google_connections").update(connection).eq("user_id", data.user.id);
        } else {
          await admin.from("google_connections").insert({ ...connection, refresh_token: null });
        }
      }
    }
  } catch {
    // Authentication remains valid; settings will explain that Calendar needs reconnection.
  }

  await supabase.rpc("accept_household_invitation");
  const { data: membership } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  const destination = membership ? safeNext(request.nextUrl.searchParams.get("next")) : "/onboarding";
  return NextResponse.redirect(new URL(destination, request.url));
}

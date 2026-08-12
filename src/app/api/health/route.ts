import { isDemoMode } from "@/lib/env";
import { query } from "@/lib/server/database";

export const dynamic = "force-dynamic";

export async function GET() {
  let database: "ready" | "demo" | "unavailable" = isDemoMode ? "demo" : "ready";
  if (!isDemoMode) {
    try {
      await query("select 1");
    } catch {
      database = "unavailable";
    }
  }
  const healthy = database !== "unavailable";
  return Response.json(
    {
      status: healthy ? "ok" : "error",
      build: process.env.APP_BUILD ?? "local",
      database,
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

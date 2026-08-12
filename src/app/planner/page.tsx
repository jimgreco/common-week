import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { WeeklyPlanner } from "@/components/planner/weekly-planner";
import { currentWeekStart, isDateOnly, weekStartForDate } from "@/lib/date";
import { getDemoPlannerData } from "@/lib/demo-data";
import { isDemoMode } from "@/lib/env";
import { getUserContext } from "@/lib/server/auth";
import { getPlannerData } from "@/lib/server/planner-data";

export const metadata: Metadata = { title: "Planner" };
export const dynamic = "force-dynamic";

export default async function PlannerPage({ searchParams }: PageProps<"/planner">) {
  const params = await searchParams;
  const requested = typeof params.week === "string" && isDateOnly(params.week)
    ? weekStartForDate(params.week)
    : currentWeekStart();

  if (isDemoMode) {
    return <WeeklyPlanner initialData={getDemoPlannerData(requested)} currentUserName="Jim" />;
  }

  const context = await getUserContext();
  if (!context) redirect("/");
  if (!context.householdId) redirect("/onboarding");
  const data = await getPlannerData(
    { userId: context.userId, householdId: context.householdId },
    requested,
    { includeExternal: false },
  );
  return <WeeklyPlanner initialData={data} currentUserName={context.displayName} />;
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { WeeklyPlanner } from "@/components/planner/weekly-planner";
import { currentWeekStart, isDateOnly, weekStartForDate } from "@/lib/date";
import { getDemoPlannerData } from "@/lib/demo-data";
import { isDemoMode } from "@/lib/env";
import { getUserContext } from "@/lib/server/auth";
import { getPlannerData } from "@/lib/server/planner-data";
import { plannerNotificationTarget } from "@/lib/notification-links";
import { getNotificationInbox, markNotificationRead, resolvePlannerNotificationTarget } from "@/lib/server/notifications";
import { loadFamilyPlanningAction } from "@/app/actions/family-planning";

export const metadata: Metadata = { title: "Planner" };
export const dynamic = "force-dynamic";

export default async function PlannerPage({ searchParams }: PageProps<"/planner">) {
  const params = await searchParams;
  const initialReview = params.review === "1";
  const notificationTarget = plannerNotificationTarget(params);
  const requestedFromQuery = typeof params.week === "string" && isDateOnly(params.week)
    ? weekStartForDate(params.week)
    : currentWeekStart();

  if (isDemoMode) {
    return <WeeklyPlanner initialData={getDemoPlannerData(notificationTarget?.weekStart ?? requestedFromQuery)} currentUserName="Jim" initialFocus={notificationTarget} initialInbox={{ items: [], unreadCount: 0 }} initialReview={initialReview} />;
  }

  const context = await getUserContext();
  if (!context) redirect("/");
  if (!context.householdId) redirect("/onboarding");
  const plannerContext = { userId: context.userId, householdId: context.householdId };
  const notificationId = typeof params.notification === "string" && /^[0-9a-f-]{36}$/i.test(params.notification)
    ? params.notification
    : null;
  const [resolvedTarget] = await Promise.all([
    notificationTarget ? resolvePlannerNotificationTarget(plannerContext, notificationTarget) : null,
    notificationId ? markNotificationRead(context.userId, notificationId) : null,
  ]);
  const requested = resolvedTarget?.weekStart ?? notificationTarget?.weekStart ?? requestedFromQuery;
  const [data, inbox, family] = await Promise.all([
    getPlannerData(plannerContext, requested, { includeExternal: false }),
    getNotificationInbox(context.userId),
    loadFamilyPlanningAction(requested),
  ]);
  return <WeeklyPlanner initialData={data} currentUserName={context.displayName} currentUserId={context.userId} initialFocus={resolvedTarget} initialInbox={inbox} initialReview={initialReview} initialFamily={family.data} />;
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createHouseholdFromForm } from "@/app/actions/settings";
import { BrandMark } from "@/components/brand-mark";
import { isSupabaseConfigured } from "@/lib/env";
import { getUserContext } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Set up household" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  if (!isSupabaseConfigured) redirect("/planner");
  const context = await getUserContext();
  if (!context) redirect("/");
  if (context.householdId) redirect("/planner");
  const params = await searchParams;

  return (
    <main className="onboarding-shell">
      <BrandMark />
      <section className="onboarding-card">
        <p className="eyebrow">Household setup</p>
        <h1>Make a place for your shared week.</h1>
        <p>Start the household now. You can invite your partner, choose calendars, and add your regular locations next.</p>
        {params.error && <div className="form-error">The household could not be created. Please try again.</div>}
        <form action={createHouseholdFromForm} className="form-stack">
          <label>Household name<input name="name" defaultValue={`${context.displayName.split(" ")[0]}’s family`} maxLength={80} required /></label>
          <label>Home timezone<select name="timezone" defaultValue="America/New_York"><option value="America/New_York">Eastern Time</option><option value="America/Chicago">Central Time</option><option value="America/Denver">Mountain Time</option><option value="America/Los_Angeles">Pacific Time</option><option value="Europe/London">London</option><option value="Europe/Paris">Central European Time</option></select></label>
          <button className="button button-primary button-large" type="submit">Create household</button>
        </form>
      </section>
    </main>
  );
}

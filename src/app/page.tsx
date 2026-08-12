import Link from "next/link";
import { ArrowRight, CalendarDays, Check, CloudSun, MapPin } from "lucide-react";
import { signInWithGoogle } from "@/app/actions/auth";
import { BrandMark } from "@/components/brand-mark";
import { currentWeekStart } from "@/lib/date";
import { isDemoMode, isGoogleOAuthConfigured } from "@/lib/env";
import { getUserContext } from "@/lib/server/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!isDemoMode) {
    const context = await getUserContext();
    if (context?.householdId) redirect("/planner");
    if (context) redirect("/onboarding");
  }

  const demoHref = `/planner?week=${currentWeekStart()}`;

  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label="Primary navigation">
        <BrandMark />
        <span className="landing-nav-note">A shared weekly planner for two</span>
      </nav>

      <section className="landing-hero">
        <div className="landing-copy">
          <p className="eyebrow">Your week, held together</p>
          <h1>Plan the life between the calendar events.</h1>
          <p className="landing-lede">
            See where you’ll be, what the weather looks like, what’s already scheduled, and what the two of you still need to decide.
          </p>
          <div className="landing-actions">
            {!isDemoMode && isGoogleOAuthConfigured ? (
              <form action={signInWithGoogle}>
                <button className="button button-primary button-large" type="submit">
                  <span className="google-g" aria-hidden="true">G</span>
                  Continue with Google
                </button>
              </form>
            ) : isDemoMode ? (
              <Link className="button button-primary button-large" href={demoHref}>
                Open interactive planner <ArrowRight size={17} aria-hidden="true" />
              </Link>
            ) : (
              <span className="landing-auth-unavailable">Google sign-in is being configured.</span>
            )}
            <span className="landing-security-note">Private by default · Calendar is read-only</span>
          </div>
        </div>

        <div className="paper-preview" aria-label="Preview of a family week">
          <div className="paper-preview-header">
            <span>August 10–16</span>
            <span>This week</span>
          </div>
          <div className="paper-preview-grid">
            {[
              ["MON 10", "East Hampton", "82° / 66°", "9:15 Camp", "Dinner: Pasta", "Groceries"],
              ["TUE 11", "East Hampton", "84° / 68°", "10:00 Farm", "Pool after nap", ""],
              ["WED 12", "East Hampton", "78° / 67°", "9:15 Camp", "Pool guy 11–2", "Pack"],
              ["THU 13", "Manhattan", "81° / 69°", "10:00 Meeting", "Dinner: Leftovers", "Dry cleaning"],
            ].map(([day, location, weather, event, plan, task]) => (
              <div className="paper-preview-day" key={day}>
                <strong>{day}</strong>
                <span className="preview-location"><MapPin size={10} />{location}</span>
                <span className="preview-weather"><CloudSun size={12} />{weather}</span>
                <small>Calendar</small>
                <span className="preview-event"><i />{event}</span>
                <small>Plans</small>
                <span>{plan}</span>
                {task && <span className="preview-task"><Check size={11} />{task}</span>}
              </div>
            ))}
          </div>
          <div className="paper-preview-weekly">
            <CalendarDays size={14} />
            <strong>This week</strong>
            <span>□ Confirm sitter</span>
            <span>□ Order groceries</span>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <span>Common Week</span>
        <span>Calendar · Location · Weather · Plans</span>
      </footer>
    </main>
  );
}

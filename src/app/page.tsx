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
        <span className="landing-nav-note">The week you share</span>
      </nav>

      <section className="landing-hero">
        <div className="landing-copy">
          <p className="eyebrow">Your week, held together</p>
          <h1>Week of Us</h1>
          <p className="landing-lede">
            A shared weekly family planner for calendars, locations, weather, notes,
            and tasks. Connect Google Calendar to view events from calendars you
            choose alongside the plans your household makes together.
          </p>
          <p className="landing-lede">
            Google Calendar access is read-only by default. Event editing is
            requested separately only when you choose to enable it.
          </p>
          <div className="landing-actions">
            {!isDemoMode && isGoogleOAuthConfigured ? (
              <form action={signInWithGoogle}>
                <button className="button button-primary button-large" type="submit">
                  <span className="google-g" aria-hidden="true">
                    <svg viewBox="0 0 18 18" role="img">
                      <path fill="#4285F4" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.716v2.258h2.909c1.702-1.567 2.684-3.876 2.684-6.615Z" />
                      <path fill="#34A853" d="M9 18c2.43 0 4.468-.806 5.956-2.18l-2.909-2.258c-.806.54-1.836.86-3.047.86-2.344 0-4.328-1.585-5.037-3.714H.955v2.332A9 9 0 0 0 9 18Z" />
                      <path fill="#FBBC05" d="M3.963 10.708A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.169.281-1.708V4.96H.955A9 9 0 0 0 0 9c0 1.453.348 2.827.955 4.04l3.008-2.332Z" />
                      <path fill="#EA4335" d="M9 3.578c1.322 0 2.508.454 3.441 1.346l2.582-2.582C13.464.891 11.426 0 9 0A9 9 0 0 0 .955 4.96l3.008 2.332C4.672 5.163 6.656 3.578 9 3.578Z" />
                    </svg>
                  </span>
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
        <span>Week of Us</span>
        <nav aria-label="Legal links">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <a href="mailto:jgreco@gmail.com">Contact</a>
        </nav>
      </footer>
    </main>
  );
}

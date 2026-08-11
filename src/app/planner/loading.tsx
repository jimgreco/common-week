import { BrandMark } from "@/components/brand-mark";

export default function PlannerLoading() {
  return (
    <main className="app-frame" aria-busy="true">
      <header className="app-topbar"><BrandMark compact /><span className="skeleton skeleton-line short" /></header>
      <section className="planner-shell">
        <div className="skeleton skeleton-title" />
        <div className="loading-week-grid">
          {Array.from({ length: 7 }, (_, index) => <div className="skeleton skeleton-day" key={index} />)}
        </div>
      </section>
    </main>
  );
}

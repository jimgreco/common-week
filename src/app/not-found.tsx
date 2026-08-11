import Link from "next/link";

export default function NotFound() {
  return (
    <main className="centered-state">
      <p className="eyebrow">404</p>
      <h1>That page isn’t part of this week.</h1>
      <Link className="button button-primary" href="/planner">Back to the planner</Link>
    </main>
  );
}

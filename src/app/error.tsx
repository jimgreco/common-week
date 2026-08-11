"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Error details stay in developer tooling; the user sees a safe recovery message.
    console.error("Planner render failed", { digest: error.digest });
  }, [error.digest]);

  return (
    <main className="centered-state">
      <AlertTriangle size={28} aria-hidden="true" />
      <h1>The planner didn’t load</h1>
      <p>Your saved week is still safe. Try loading it again.</p>
      <button className="button button-primary" onClick={reset} type="button">
        <RotateCcw size={15} /> Try again
      </button>
    </main>
  );
}

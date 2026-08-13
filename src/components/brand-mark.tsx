import Link from "next/link";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link className={`brand-mark ${compact ? "brand-mark-compact" : ""}`} href="/planner" aria-label="Week of Us home">
      <span className="brand-glyph" aria-hidden="true">
        <i /><i /><i />
      </span>
      <span>Week of Us</span>
    </Link>
  );
}

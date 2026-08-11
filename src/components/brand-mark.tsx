import Link from "next/link";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link className={`brand-mark ${compact ? "brand-mark-compact" : ""}`} href="/planner" aria-label="Common Week home">
      <span className="brand-glyph" aria-hidden="true">
        <i /><i /><i />
      </span>
      <span>Common Week</span>
    </Link>
  );
}

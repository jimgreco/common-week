import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

interface LegalSection {
  title: string;
  paragraphs?: string[];
  items?: string[];
}

export function LegalPage({
  eyebrow,
  title,
  updated,
  introduction,
  sections,
}: {
  eyebrow: string;
  title: string;
  updated: string;
  introduction: string;
  sections: LegalSection[];
}) {
  return (
    <main className="legal-shell">
      <nav className="landing-nav legal-nav" aria-label="Legal navigation">
        <BrandMark />
        <Link href="/">Back to Week of Us</Link>
      </nav>
      <article className="legal-document">
        <header>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="legal-updated">Effective and last updated {updated}</p>
          <p className="legal-introduction">{introduction}</p>
        </header>
        {sections.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            {section.items && <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>}
          </section>
        ))}
        <footer>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
          <a href="mailto:jgreco@gmail.com">Contact</a>
        </footer>
      </article>
    </main>
  );
}

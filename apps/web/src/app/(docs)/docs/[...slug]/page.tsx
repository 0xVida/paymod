import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ALL_DOCS, findDoc } from "@/lib/docs";

type PageProps = { params: Promise<{ slug: string[] }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const doc = findDoc((await params).slug);
  return { title: doc ? `${doc.title} - Paymod Docs` : "Docs - Paymod" };
}

export default async function DocumentationPage({ params }: PageProps) {
  const doc = findDoc((await params).slug);
  if (!doc) notFound();
  const index = ALL_DOCS.findIndex((candidate) => candidate.slug === doc.slug);
  const previous = index > 0 ? ALL_DOCS[index - 1] : undefined;
  const next = index < ALL_DOCS.length - 1 ? ALL_DOCS[index + 1] : undefined;
  return (
    <article className="docs-article">
      <Link href="/docs" className="docs-back">
        Documentation / {doc.title}
      </Link>
      <header className="docs-page-header">
        {doc.status ? <span className="docs-status">{doc.status}</span> : null}
        <h1>{doc.title}</h1>
        <p>{doc.summary}</p>
      </header>
      {doc.diagram ? <pre className="docs-diagram">{doc.diagram}</pre> : null}
      <div className="docs-prose">
        {doc.body.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      {doc.bullets ? (
        <section className="docs-list-section">
          <h2>What this covers</h2>
          <ol>
            {doc.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ol>
        </section>
      ) : null}
      <nav className="docs-pagination" aria-label="Adjacent documentation">
        <div>
          {previous ? (
            <Link href={previous.slug ? `/docs/${previous.slug}` : "/docs"}>
              <span>Previous</span>
              {previous.title}
            </Link>
          ) : null}
        </div>
        <div>
          {next ? (
            <Link href={next.slug ? `/docs/${next.slug}` : "/docs"}>
              <span>Next</span>
              {next.title}
            </Link>
          ) : null}
        </div>
      </nav>
    </article>
  );
}

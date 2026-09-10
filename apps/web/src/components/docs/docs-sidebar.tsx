"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ALL_DOC_GROUPS } from "@/lib/docs";

export function DocsSidebar() {
  const pathname = usePathname();
  const activeSlug = pathname === "/docs" ? "" : pathname.replace(/^\/docs\//, "");
  const activeGroup = ALL_DOC_GROUPS.find((group) =>
    group.pages.some((doc) => doc.slug === activeSlug),
  );
  const [manual, setManual] = useState<{ pathname: string; group: string } | null>(null);
  const openGroup = manual?.pathname === pathname ? manual.group : (activeGroup?.title ?? null);

  return (
    <nav className="docs-nav" aria-label="Documentation navigation">
      {ALL_DOC_GROUPS.map((group) => {
        const open = openGroup === group.title;
        return (
          <section key={group.title} className="docs-nav-group">
            <button
              type="button"
              className="docs-nav-trigger"
              onClick={() => setManual({ pathname, group: open ? "" : group.title })}
              aria-expanded={open}
            >
              <span>{group.title}</span>
              <ChevronRight
                className={open ? "docs-nav-chevron docs-nav-chevron-open" : "docs-nav-chevron"}
              />
            </button>
            {open ? (
              <div className="docs-nav-items">
                {group.pages.map((doc) => (
                  <Link
                    key={doc.slug}
                    href={doc.slug ? `/docs/${doc.slug}` : "/docs"}
                    className={cn(
                      "docs-nav-link",
                      doc.slug === activeSlug && "docs-nav-link-active",
                    )}
                  >
                    {doc.title}
                  </Link>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </nav>
  );
}

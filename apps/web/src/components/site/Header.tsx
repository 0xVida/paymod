"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MENU_LINKS } from "@/lib/nav";
import { scrollToId } from "@/lib/scroll";
import Logo from "./Logo";

/**
 * always links to `/dashboard` rather than checking sign-in state itself -
 * `(dashboard)/dashboard/layout.tsx` already redirects to `/login` when
 * there's no session, so this stays a static link with zero API dependency
 * instead of a second, redundant auth check that could block or flash.
 */
export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!barRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [menuOpen]);

  return (
    <div className="hero-masthead-bar" ref={barRef}>
      <Link href="/" className="hero-masthead-brand" aria-label="Paymod home">
        <Logo size={34} />
        <span className="hero-masthead-brand-text pc-display">Paymod</span>
      </Link>

      <div className="hero-masthead-cta-group">
        <Link href="/docs" className="hero-masthead-cta-link pc-label">
          Read the docs
        </Link>
        <span className="hero-masthead-cta-sep" aria-hidden="true">
          /
        </span>
        <Link href="/dashboard" className="hero-masthead-cta-link pc-label">
          Dashboard
        </Link>
      </div>

      <button
        type="button"
        className="hero-masthead-menu"
        onClick={() => setMenuOpen((open) => !open)}
        aria-expanded={menuOpen}
        aria-controls="masthead-drop-nav"
        aria-label="Menu"
      >
        <span className="hero-masthead-menu-lines">
          <span />
          <span />
          <span />
        </span>
      </button>

      {menuOpen && (
        <nav id="masthead-drop-nav" className="hero-masthead-drop pc-label" aria-label="Menu">
          {}
          <a
            href="/dashboard"
            className="hero-masthead-drop-mobile-only"
            onClick={() => setMenuOpen(false)}
          >
            <span>Dashboard</span>
            <span aria-hidden="true">↗</span>
          </a>
          {MENU_LINKS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={(event) => {
                setMenuOpen(false);
                if (item.href.startsWith("#")) {
                  event.preventDefault();
                  scrollToId(item.href.slice(1));
                }
              }}
            >
              <span>{item.label}</span>
              <span aria-hidden="true">↗</span>
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { MENU_LINKS } from "@/lib/nav";
import { scrollToId } from "@/lib/scroll";
import Logo from "./Logo";

export default function Header() {
  /**
   * starts signed-out so the page never blocks its first paint on the API -
   * upgrades in place once the client-side check resolves, instead of the
   * server component awaiting `/v1/auth/me` before rendering anything.
   */
  const [isSignedIn, setIsSignedIn] = useState(false);
  const walletHref = isSignedIn ? "/dashboard" : "/login";
  const [menuOpen, setMenuOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/v1/auth/me")
      .then(() => {
        if (!cancelled) setIsSignedIn(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
        <Link href={walletHref} className="hero-masthead-cta-link pc-label">
          Create Agent Wallet
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
            href={walletHref}
            className="hero-masthead-drop-mobile-only"
            onClick={() => setMenuOpen(false)}
          >
            <span>Create Agent Wallet</span>
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
